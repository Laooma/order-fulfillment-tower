import { McpClient } from './mcpClient'
import type { McpTool, McpCallContext } from '../types'
import { McpPoolExhaustedError } from '../types'

const POOL_SIZE = parseInt(process.env.MCP_POOL_SIZE || '4', 10)
const ACQUIRE_TIMEOUT_MS = parseInt(process.env.MCP_ACQUIRE_TIMEOUT_MS || '30000', 10)
const HEALTH_CHECK_INTERVAL_MS = 15000

interface PooledClient {
  client: McpClient
  busy: boolean
  id: number
}

interface QueueEntry {
  resolve: (handle: PooledClientHandle) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class PooledClientHandle {
  constructor(
    private pool: McpPool,
    private pooled: PooledClient,
    private context?: McpCallContext,
  ) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.pooled.client.callTool(name, args, this.context)
  }

  release(): void {
    this.pool.release(this)
  }

  getClientId(): number {
    return this.pooled.id
  }
}

export class McpPool {
  private clients: PooledClient[] = []
  private queue: QueueEntry[] = []
  private healthCheckTimer?: ReturnType<typeof setInterval>
  private tools: McpTool[] = []
  private initialized = false

  async initialize(poolSize: number = POOL_SIZE): Promise<void> {
    const size = Math.max(1, poolSize)
    console.log(`[McpPool] Initializing pool with ${size} clients...`)

    for (let i = 0; i < size; i++) {
      const client = new McpClient()
      try {
        await client.connect()
      } catch (err) {
        console.error(`[McpPool] Client ${i} failed to connect:`, err)
      }
      this.clients.push({ client, busy: false, id: i })

      client.on('disconnected', () => {
        console.warn(`[McpPool] Client ${i} disconnected, will attempt reconnect on next health check`)
      })
    }

    const connectedCount = this.clients.filter(c => c.client.isConnected()).length
    if (connectedCount > 0) {
      this.tools = this.clients.find(c => c.client.isConnected())!.client.getTools()
    }

    this.startHealthCheck()
    this.initialized = true
    console.log(`[McpPool] Initialized: ${connectedCount}/${size} clients connected, ${this.tools.length} tools available`)
  }

  async acquire(context?: McpCallContext): Promise<PooledClientHandle> {
    const idle = this.clients.find(c => !c.busy && c.client.isConnected())
    if (idle) {
      idle.busy = true
      return new PooledClientHandle(this, idle, context)
    }

    return new Promise<PooledClientHandle>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.resolve === resolve)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new McpPoolExhaustedError(ACQUIRE_TIMEOUT_MS))
      }, ACQUIRE_TIMEOUT_MS)

      this.queue.push({ resolve, reject, timer })
    })
  }

  release(handle: PooledClientHandle): void {
    const pooled = (handle as any).pooled as PooledClient
    pooled.busy = false

    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      clearTimeout(next.timer)
      pooled.busy = true
      next.resolve(new PooledClientHandle(this, pooled, undefined))
    }
  }

  getTools(): McpTool[] {
    return this.tools
  }

  isConnected(): boolean {
    return this.clients.some(c => c.client.isConnected())
  }

  getStats(): { total: number; idle: number; busy: number; queued: number } {
    return {
      total: this.clients.length,
      idle: this.clients.filter(c => !c.busy && c.client.isConnected()).length,
      busy: this.clients.filter(c => c.busy).length,
      queued: this.queue.length,
    }
  }

  shutdown(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = undefined
    }
    for (const entry of this.queue) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Pool shutting down'))
    }
    this.queue = []
    for (const c of this.clients) {
      c.client.disconnect()
    }
    this.initialized = false
    console.log('[McpPool] Shutdown complete')
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck()
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  private async runHealthCheck(): Promise<void> {
    for (const pooled of this.clients) {
      if (!pooled.client.isAlive() && !pooled.busy) {
        console.log(`[McpPool] Health check: client ${pooled.id} is dead, attempting reconnect...`)
        let reconnected = false
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await pooled.client.reconnect()
            if (pooled.client.isConnected()) {
              reconnected = true
              console.log(`[McpPool] Client ${pooled.id} reconnected on attempt ${attempt}`)
              break
            }
          } catch (err) {
            console.error(`[McpPool] Client ${pooled.id} reconnect attempt ${attempt} failed:`, err)
          }
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 2000))
          }
        }
        if (!reconnected) {
          console.error(`[McpPool] Client ${pooled.id} failed to reconnect after 3 attempts`)
        }
      }
    }

    const connected = this.clients.find(c => c.client.isConnected())
    if (connected && connected.client.getTools().length > 0) {
      this.tools = connected.client.getTools()
    }
  }
}
