import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import type { WsMessage } from './types'

import ordersRouter from './routes/orders'
import cabinetPackagesRouter from './routes/cabinet-packages'
import tasksRouter from './routes/tasks'
import analysisRouter from './routes/analysis'
import rbacRouter from './routes/rbac'
import authRouter from './routes/auth'
import { notificationsRouter } from './routes/notifications'
import { authMiddleware } from './middleware/auth'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws/chat' })

const PORT = process.env.PORT || 3001

// Middleware
app.use(cors({ origin: '*' }))
app.use(express.json())
app.use(authMiddleware)

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

import { getChatMessages, saveChatMessage, saveChatMessages, getChatSessions, updateSessionTitle } from './services/database'

// API routes
app.use('/api/orders', ordersRouter)
app.use('/api/cabinet-packages', cabinetPackagesRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/analysis', analysisRouter)
app.use('/api', rbacRouter)
app.use('/api/auth', authRouter)
app.use('/api', notificationsRouter)

// Chat session listing
app.get('/api/chat/sessions', (_req, res) => {
  try {
    const sessions = getChatSessions()
    res.json({ data: sessions })
  } catch (err) {
    console.error('[Chat] List sessions error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// Chat message persistence
app.get('/api/chat/:sessionId', (req, res) => {
  try {
    const messages = getChatMessages(req.params.sessionId)
    res.json({ data: messages })
  } catch (err) {
    console.error('[Chat] Get messages error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

app.post('/api/chat/:sessionId', (req, res) => {
  try {
    const { role, content, toolCallId, toolCalls } = req.body
    if (!role || !content) {
      res.status(400).json({ error: 'role and content are required' })
      return
    }
    saveChatMessage(req.params.sessionId, role, content, toolCallId, toolCalls)
    res.json({ success: true })
  } catch (err) {
    console.error('[Chat] Save message error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

app.post('/api/chat/:sessionId/batch', (req, res) => {
  try {
    const { messages } = req.body
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array is required' })
      return
    }
    const result = saveChatMessages(req.params.sessionId, messages)
    res.json(result)
  } catch (err) {
    console.error('[Chat] Save batch error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// Update session title (called by agent loop after generating LLM summary)
app.put('/api/chat/:sessionId/title', (req, res) => {
  try {
    const { title } = req.body
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' })
      return
    }
    updateSessionTitle(req.params.sessionId, title.trim().slice(0, 50))
    res.json({ success: true })
  } catch (err) {
    console.error('[Chat] Update title error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// WebSocket chat handler
const sessions = new Map<string, WebSocket>()

wss.on('connection', (ws) => {
  console.log('[WS] Client connected')

  ws.on('message', (raw) => {
    try {
      const msg: WsMessage = JSON.parse(raw.toString())
      console.log('[WS] Received:', msg.type)

      if (msg.type === 'chat' && msg.sessionId) {
        sessions.set(msg.sessionId, ws)
        handleChat(ws, msg)
      }
    } catch (err) {
      console.error('[WS] Invalid message:', err)
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }))
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
    // Clean up sessions
    for (const [sid, socket] of sessions.entries()) {
      if (socket === ws) sessions.delete(sid)
    }
  })

  ws.on('error', (err) => {
    console.error('[WS] Error:', err)
  })
})

async function handleChat(ws: WebSocket, msg: WsMessage) {
  const { sessionId, message, orders } = msg
  if (!sessionId) return

  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY

  if (!hasAnthropicKey) {
    // Simulated streaming response (fallback when no API key)
    const chunks = [
      '正在分析您选中的订单数据...',
      `已识别 ${orders?.length || 0} 个合同...`,
      '正在查询销售系统、ERP及采购系统数据...',
      '分析完成，发现以下履约卡点：\n1. 发货延迟：2个合同\n2. 入库待确认：3个物料\n3. 异常待处理：1个订单',
    ]

    for (const chunk of chunks) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chunk', content: chunk }))
      }
      await delay(800)
    }

    if (ws.readyState === WebSocket.OPEN) {
      const analysisId = `T20260515${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`
      ws.send(JSON.stringify({
        type: 'complete',
        analysisId,
        redirect: `/analysis/${analysisId}`,
      }))
    }
    return
  }

  // TODO: Integrate Anthropic API for real AI streaming
  // This requires the @anthropic-ai/sdk package and proper prompt engineering
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`WebSocket available at ws://localhost:${PORT}/ws/chat`)
})
