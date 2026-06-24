import { useCallback, useEffect, useRef, useState } from 'react'

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
  verified?: boolean
}

export interface WsMessage {
  type: 'chat' | 'abort' | 'chunk' | 'complete' | 'stopped' | 'error' | 'skill_assigned' | 'tool_call' | 'tool_result' | 'status' | 'todo_list' | 'a2ui_surface' | 'task_boundary' | 'context_update' | 'compacting' | 'todo_suggestion' | 'verification_result'
  sessionId?: string
  skillId?: string
  autoAssign?: boolean
  model?: string
  message?: string
  content?: string
  analysisId?: string
  analysisTitle?: string
  redirect?: string
  hasStructuredResult?: boolean
  orders?: string[]
  cabinetPackages?: string[]
  images?: Array<{ dataUrl: string; name: string }>
  taskId?: string
  taskContent?: string
  verified?: boolean
  verificationNote?: string
  assignedSkillId?: string
  assignedSkillName?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolLabel?: string
  status?: 'thinking' | 'calling_tool' | 'responding'
  skillName?: string
  skillIcon?: string
  skillColor?: string
  modelId?: string
  elapsed?: number
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  contextWindow?: number
  errorMessage?: string
  todos?: TodoItem[]
  action?: 'create' | 'update'
  incompleteTasks?: string[]
  phase?: 'start' | 'done'
  messages?: Array<{ role: string; content: string }>
  title?: string
  suggestedTodos?: Array<{
    category: string
    description: string
    priority: string
    assignee?: string
    dueDate?: string
    taskType?: string
    contractNumber?: string
  }>
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<WsMessage[]>([])
  const [thinking, setThinking] = useState(false)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const reconnectAttempts = useRef(0)
  const mountedRef = useRef(true)
  const MAX_RECONNECT_DELAY = 30000

  const connect = useCallback(() => {
    // Don't connect if component unmounted
    if (!mountedRef.current) return
    // Don't create a new connection if one is already open or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return

    // Clean up any previous socket that's in a closing/closed state
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
    }

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close()
        return
      }
      console.log('[WS] Connected')
      setConnected(true)
      reconnectAttempts.current = 0
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      try {
        const msg: WsMessage = JSON.parse(event.data)
        setMessages((prev) => [...prev, msg])
        if (msg.type === 'chunk') {
          setThinking(true)
        }
        if (msg.type === 'complete' || msg.type === 'error') {
          setThinking(false)
        }
      } catch {
        console.error('[WS] Failed to parse message')
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      console.log('[WS] Disconnected, will reconnect...')
      setConnected(false)
      // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), MAX_RECONNECT_DELAY)
      reconnectAttempts.current++
      reconnectTimer.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      // Don't call ws.close() here — the browser already handles cleanup.
      // Calling close() would trigger onclose() synchronously, potentially
      // creating a duplicate reconnect timer (one from onerror→close→onclose,
      // another from the browser's own close→onclose sequence).
      console.error('[WS] Error (will reconnect automatically)')
    }
  }, [url])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null  // Prevent reconnect timer on intentional close
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = useCallback((msg: WsMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return true
    }
    return false
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return { connected, messages, thinking, send, clearMessages }
}
