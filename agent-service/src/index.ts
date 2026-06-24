import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.claw/.env') })
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import type { AgentMessage } from './types'
import skillsRouter from './routes/skills'
import hooksRouter from './routes/hooks'
import mcpRouter from './routes/mcp'
import pluginsRouter from './routes/plugins'
import modelsRouter from './routes/models'
import { createCronTasksRouter, createApiRouter } from './routes/cronTasks'
import dingtalkAgentRouter from './routes/dingtalkAgent'
import { createToolsRouter } from './routes/tools'
import { createTasksRouter } from './routes/tasks'
import { CronScheduler } from './services/cronScheduler'
import { McpPool } from './services/mcpPool'
import { SessionStore } from './services/sessionStore'
import { handleAgentMessage, abortSession, initAgentLoop } from './services/agentLoop'

const scheduler = new CronScheduler()
const mcpPool = new McpPool()
const sessionStore = new SessionStore()

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws/agent' })

const PORT = process.env.PORT || 3002

// Middleware
app.use(cors({ origin: '*' }))
app.use(express.json())

// Health check
app.get('/health', (_req, res) => {
  const poolStats = mcpPool.getStats()
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mcpConnected: mcpPool.isConnected(),
    mcpPoolStats: poolStats,
    mcpTools: mcpPool.getTools().length,
  })
})

// Usage stats (project-level token tracking, like Claude Code /cost)
app.get('/usage/summary', (req, res) => {
  try {
    const userId = req.query.userId as string | undefined
    res.json(sessionStore.getUsageSummary(userId))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/usage/daily', (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 14
    const userId = req.query.userId as string | undefined
    res.json(sessionStore.getDailyUsage(days, userId))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/usage/models', (req, res) => {
  try {
    const userId = req.query.userId as string | undefined
    res.json(sessionStore.getModelUsage(userId))
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// API routes
app.use('/skills', skillsRouter)
app.use('/hooks', hooksRouter)
app.use('/mcp', mcpRouter)
app.use('/plugins', pluginsRouter)
app.use('/models', modelsRouter)
app.use('/tools', createToolsRouter(mcpPool))
app.use('/tasks', createTasksRouter(sessionStore))
app.use('/cron-tasks', createCronTasksRouter(scheduler))
app.use('/api', createApiRouter())
app.use('/api', dingtalkAgentRouter)

// WebSocket agent handler
wss.on('connection', (ws) => {
  console.log('[WS] Agent client connected')

  ws.on('message', async (raw) => {
    try {
      const msg: AgentMessage = JSON.parse(raw.toString())
      console.log('[WS] Received:', msg.type, msg.sessionId)

      // Allow todo generation messages without skillId/autoAssign — these are system-triggered
      const isTodoGen = msg.taskId && msg.message?.startsWith('请为以下合同生成待办清单')
      if (msg.type === 'chat' && msg.sessionId && (msg.skillId || msg.autoAssign || isTodoGen)) {
        await handleAgentMessage(ws, msg, mcpPool)
      } else if (msg.type === 'chat') {
        ws.send(JSON.stringify({ type: 'error', content: '请选择一个Skill或开启自动分配', sessionId: msg.sessionId }))
      } else if (msg.type === 'abort') {
        abortSession(msg.sessionId || '')
        ws.send(JSON.stringify({ type: 'stopped', sessionId: msg.sessionId }))
      }
    } catch (err) {
      console.error('[WS] Invalid message:', err)
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }))
    }
  })

  ws.on('close', () => {
    console.log('[WS] Agent client disconnected')
  })

  ws.on('error', (err) => {
    console.error('[WS] Error:', err)
  })
})

// Startup
async function start() {
  try {
    await mcpPool.initialize()
  } catch (err) {
    console.error('[Startup] MCP pool initialization failed, running in fallback mode:', err)
  }

  // Initialize agent loop with pool and session store references
  initAgentLoop(mcpPool, sessionStore)

  // Start session cleanup
  sessionStore.startCleanup()

  server.listen(PORT, () => {
    console.log(`Agent Service running on http://localhost:${PORT}`)
    console.log(`WebSocket available at ws://localhost:${PORT}/ws/agent`)
    const stats = mcpPool.getStats()
    console.log(`MCP pool: ${stats.idle} idle / ${stats.total} total, tools: ${mcpPool.getTools().length}`)
    scheduler.start()
  })
}

start()

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Stopping scheduler...')
  scheduler.stop()
  console.log('[Shutdown] Stopping session cleanup...')
  sessionStore.stopCleanup()
  console.log('[Shutdown] Closing MCP pool...')
  mcpPool.shutdown()
  sessionStore.close()
  server.close(() => {
    console.log('[Shutdown] Server closed')
    process.exit(0)
  })
})
