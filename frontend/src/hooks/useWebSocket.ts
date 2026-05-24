import { useCallback, useEffect, useRef, useState } from 'react'

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
  verified?: boolean
}

export interface WsMessage {
  type: 'chat' | 'abort' | 'chunk' | 'complete' | 'stopped' | 'error' | 'skill_assigned' | 'tool_call' | 'tool_result' | 'status' | 'todo_list' | 'a2ui_surface' | 'task_boundary'
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
  messages?: Array<{ role: string; content: string }>
  title?: string
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<WsMessage[]>([])
  const [thinking, setThinking] = useState(false)

  useEffect(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
      setConnected(true)
    }

    ws.onmessage = (event) => {
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
      console.log('[WS] Disconnected')
      setConnected(false)
    }

    ws.onerror = (err) => {
      console.error('[WS] Error:', err)
    }

    return () => {
      ws.close()
    }
  }, [url])

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return { connected, messages, thinking, send, clearMessages }
}
