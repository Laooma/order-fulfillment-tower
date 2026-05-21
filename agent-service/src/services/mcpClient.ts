import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import type { McpTool, McpCallContext } from '../types'

const CLAW_BINARY = process.env.CLAW_BINARY_PATH || ''

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | null
  result?: unknown
  error?: { code: number; message: string }
}

export class McpClient extends EventEmitter {
  private process?: ChildProcess
  private requestId = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private tools: McpTool[] = []
  private connected = false
  private mockMode = false

  async connect(): Promise<void> {
    if (!CLAW_BINARY || !this.clawExists()) {
      console.warn('[McpClient] claw binary not found, using mock mode')
      this.mockMode = true
      this.tools = this.getMockTools()
      this.connected = true
      return
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP connection timeout')), 10000)

      this.process = spawn(CLAW_BINARY, ['mcp', 'serve'], {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '0' },
      })

      this.process.stdout?.on('data', (data: Buffer) => this.handleData(data))
      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text) console.log('[claw stderr]', text)
      })
      this.process.on('exit', (code) => {
        this.connected = false
        console.log(`[McpClient] claw process exited with code ${code}`)
        this.emit('disconnected', code)
      })
      this.process.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      // Send initialize
      this.sendRequest('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'order-tower-agent', version: '1.0.0' } })
        .then(() => this.sendRequest('tools/list', {}))
        .then((result: any) => {
          this.tools = result?.tools || []
          this.connected = true
          clearTimeout(timeout)
          console.log(`[McpClient] Connected, ${this.tools.length} tools available`)
          resolve()
        })
        .catch((err) => {
          clearTimeout(timeout)
          reject(err)
        })
    })
  }

  disconnect(): void {
    this.process?.kill()
    this.connected = false
  }

  getTools(): McpTool[] {
    return this.tools
  }

  isConnected(): boolean {
    return this.connected
  }

  isAlive(): boolean {
    if (this.mockMode) return this.connected
    return this.connected && this.process !== undefined && !this.process.killed && this.process.exitCode === null
  }

  async reconnect(): Promise<void> {
    this.disconnect()
    await this.connect()
  }

  async callTool(name: string, arguments_: Record<string, unknown>, context?: McpCallContext): Promise<unknown> {
    let args = { ...arguments_ }
    if (context?.workDir && name === 'bash') {
      args.cwd = context.workDir
    }
    if (context?.env) {
      args.__session_env = context.env
    }
    if (this.mockMode) {
      return this.executeMockTool(name, args)
    }
    return this.sendRequest('tools/call', { name, arguments: args })
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      this.pending.set(id, { resolve, reject })

      const req: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      const line = JSON.stringify(req) + '\n'
      this.process?.stdin?.write(line, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg: JsonRpcResponse = JSON.parse(line)
        if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id as number)
          if (pending) {
            this.pending.delete(msg.id as number)
            if (msg.error) {
              pending.reject(new Error(msg.error.message))
            } else {
              pending.resolve(msg.result)
            }
          }
        }
      } catch {
        // Ignore malformed lines
      }
    }
  }

  private clawExists(): boolean {
    try {
      const fs = require('fs')
      return fs.existsSync(CLAW_BINARY)
    } catch {
      return false
    }
  }

  private getMockTools(): McpTool[] {
    return [
      {
        name: 'Skill',
        description: '加载一个本地 skill 定义及其指令内容。',
        inputSchema: {
          type: 'object',
          properties: { skill: { type: 'string', description: 'skill 名称或路径' } },
          required: ['skill'],
        },
      },
      {
        name: 'bash',
        description: '在当前工作区执行 shell 命令。',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['command'],
        },
      },
      {
        name: 'read_file',
        description: '读取文件内容。',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string' },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'TodoWrite',
        description: '写入待办事项列表。',
        inputSchema: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  content: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
                  priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
              },
            },
          },
          required: ['todos'],
        },
      },
    ]
  }

  private executeMockTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    console.log(`[McpClient][Mock] ${name}(${JSON.stringify(arguments_)})`)
    switch (name) {
      case 'Skill': {
        const { loadSkills } = require('./skillLoader')
        const skill = loadSkills().find((s: any) => s.id === arguments_.skill || s.name === arguments_.skill)
        return Promise.resolve({
          content: skill ? [{ type: 'text', text: skill.prompt }] : [{ type: 'text', text: `Skill not found: ${arguments_.skill}` }],
        })
      }
      case 'bash':
        return Promise.resolve({ content: [{ type: 'text', text: `[Mock] Would execute: ${arguments_.command}` }] })
      case 'read_file':
        return Promise.resolve({ content: [{ type: 'text', text: `[Mock] Would read: ${arguments_.file_path}` }] })
      case 'TodoWrite':
        return Promise.resolve({ content: [{ type: 'text', text: `[Mock] Todo list updated with ${(arguments_.todos as any[])?.length || 0} items.` }] })
      default:
        return Promise.resolve({ content: [{ type: 'text', text: `[Mock] Tool ${name} not implemented in mock mode.` }] })
    }
  }
}
