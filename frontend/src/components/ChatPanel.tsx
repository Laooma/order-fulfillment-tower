import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { cn } from '../lib/utils'
import { api, type Skill } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import { getSkillIcon } from '../lib/skillIcons'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import TodoWidget from './TodoWidget'
import MarkdownRenderer from './MarkdownRenderer'
import type { TodoItem } from '../hooks/useWebSocket'

interface ModelInfo {
  id: string
  name: string
  tag: string
  provider: string
}

const MODEL_COLORS: Record<string, string> = {
  DeepSeek: '#2563eb',
  '火山引擎': '#ee4d2d',
  OpenAI: '#10a37f',
}

const MODEL_ICONS: Record<string, string> = {
  DeepSeek: 'D',
  '火山引擎': '豆',
  OpenAI: 'O',
}

interface ToolCallRecord {
  name: string
  label: string
  output?: string
  done: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallRecord[]
}

export interface ChatPanelHandle {
  sendMessage: (message: string, opts?: { taskId?: string; orders?: string[] }) => void
}

const ChatPanel = forwardRef<ChatPanelHandle>(function ChatPanel(_props, ref) {
  const hasSkill = useAuthStore((s) => s.hasSkill)
  const [chatInput, setChatInput] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [activeAgent, setActiveAgent] = useState<Skill | null>(null)
  const [showAgentPopup, setShowAgentPopup] = useState(false)
  const [autoAssign, setAutoAssign] = useState(false)
  const [pureChat, setPureChat] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModelId, setSelectedModelId] = useState('')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [pendingAnalysis, setPendingAnalysis] = useState<{ id: string; redirect: string } | null>(null)
  const processedWsCount = useRef(0)
  const [streamStatus, setStreamStatus] = useState<'idle' | 'thinking' | 'calling_tool' | 'responding'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [tokenStats, setTokenStats] = useState<{ total: number; prompt: number; completion: number } | null>(null)
  const [contextWindow, setContextWindow] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [taskOutputs, setTaskOutputs] = useState<Record<string, string>>({})
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentResponseRef = useRef('')
  const thinkingContentRef = useRef('')
  const [toolCallHistory, setToolCallHistory] = useState<ToolCallRecord[]>([])
  const [rightPanelWidth, setRightPanelWidth] = useState(Math.round(window.innerWidth * 0.25))
  const [collapsed, setCollapsed] = useState(false)
  const [todoPanelCollapsed, setTodoPanelCollapsed] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set())
  const [localTab, setLocalTab] = useState<'chat' | 'editor'>('chat')
  const [editorLang, setEditorLang] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showQuotePopup, setShowQuotePopup] = useState(false)
  const [quotedMessage, setQuotedMessage] = useState<{ index: number; content: string } | null>(null)
  const quotePopupRef = useRef<HTMLDivElement>(null)
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const userScrolledUpEditor = useRef(false)
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // Store selectors
  const pageConfig = useChatStore((s) => s.pageConfig)
  const footerSlot = useChatStore((s) => s.footerSlot)
  const detailSlot = useChatStore((s) => s.detailSlot)
  const setSendMessage = useChatStore((s) => s.setSendMessage)
  const setIsRunning = useChatStore((s) => s.setIsRunning)
  const lockAgent = pageConfig?.lockAgent ?? false
  const tabs = pageConfig?.tabs
  const activeTab = pageConfig?.activeTab ?? 'chat'
  const onTabChange = pageConfig?.onTabChange
  const onAnalysisNavigate = pageConfig?.onAnalysisNavigate
  const onAnalysisComplete = pageConfig?.onAnalysisComplete
  const onA2uiSurface = pageConfig?.onA2uiSurface
  const orders = pageConfig?.orders
  const onClearOrders = pageConfig?.onClearOrders
  const sessionId = useRef(`global-${Date.now()}`).current

  const WS_URL = (import.meta.env.VITE_AGENT_BASE_URL || 'http://localhost:3002').replace(/^http/, 'ws') + '/ws/agent'
  const { messages: wsMessages, send: wsSend } = useWebSocket(WS_URL)

  const modelWrapRef = useRef<HTMLDivElement>(null)
  const agentPopupRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const todoPanelRef = useRef<HTMLDivElement>(null)
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const userScrolledUpTodo = useRef(false)
  const userScrolledUpChat = useRef(false)

  const showChat = !tabs || activeTab === 'chat'

  // Extract code blocks from messages for the editor tab
  const editorBlocks = (() => {
    const blocks: Array<{ lang: string; code: string; msgIdx: number }> = []
    messages.forEach((msg, msgIdx) => {
      if (msg.role !== 'assistant' || !msg.content) return
      const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g
      let match
      while ((match = codeBlockRe.exec(msg.content)) !== null) {
        blocks.push({ lang: match[1] || 'text', code: match[2].trimEnd(), msgIdx })
      }
    })
    return blocks
  })()
  const hasEditorBlocks = editorBlocks.length > 0

  // Sync isRunning to store
  useEffect(() => {
    setIsRunning(isSending)
  }, [isSending, setIsRunning])

  // Messages persist globally across page navigations.
  // History is only cleared via the "new conversation" button (handleNewConversation).

  // Load skills and models
  useEffect(() => {
    setSkillsLoading(true)
    Promise.all([
      api.agent.skills(),
      api.agent.models(),
    ])
      .then(([skillsRes, modelsRes]) => {
        const filtered = skillsRes.skills.filter((s) => hasSkill(s.id))
        setSkills(filtered)
        if (filtered.length > 0 && !activeAgent) {
          setActiveAgent(filtered[0])
        }
        setModels(modelsRes.models)
        if (modelsRes.defaultModel && !selectedModelId) {
          setSelectedModelId(modelsRes.defaultModel)
        } else if (modelsRes.models.length > 0 && !selectedModelId) {
          setSelectedModelId(modelsRes.models[0].id)
        }
      })
      .catch((err) => console.error('Failed to load skills/models:', err))
      .finally(() => setSkillsLoading(false))
  }, [])

  // Handle WebSocket messages
  useEffect(() => {
    if (wsMessages.length === 0) {
      processedWsCount.current = 0
      return
    }
    const newCount = wsMessages.length
    const toProcess = wsMessages.slice(processedWsCount.current)
    processedWsCount.current = newCount

    for (const msg of toProcess) {
      if (msg.type === 'chunk' && msg.content !== undefined) {
        const chunkContent = msg.content
        currentResponseRef.current += chunkContent
        // During 'thinking' phase, accumulate into thinking content
        if (streamStatus === 'thinking') {
          thinkingContentRef.current += chunkContent
        } else {
          // During 'responding' or other phase, append to message content
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1]
            if (lastMsg?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + chunkContent }]
            }
            return [...prev, { role: 'assistant', content: chunkContent }]
          })
        }
        if (msg.taskId) {
          setTaskOutputs((prev) => ({
            ...prev,
            [msg.taskId!]: (prev[msg.taskId!] || '') + chunkContent,
          }))
        }
      }
      if (msg.type === 'status') {
        const prevStatus = streamStatus
        if (msg.status) {
          setStreamStatus(msg.status)
        }
        // Flush thinking content when leaving 'thinking' phase
        if (prevStatus === 'thinking' && msg.status && msg.status !== 'thinking') {
          const thinking = thinkingContentRef.current
          thinkingContentRef.current = ''
          if (thinking) {
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1]
              if (lastMsg?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...lastMsg, thinking: (lastMsg.thinking || '') + thinking }]
              }
              return [...prev, { role: 'assistant', content: '', thinking }]
            })
          }
        }
      }
      if (msg.type === 'tool_call') {
        const label = msg.toolLabel || msg.toolName || ''
        const newTc: ToolCallRecord = { name: msg.toolName || '', label, done: false }
        setToolCallHistory((prev) => [...prev, newTc])
        setStatusMessage(label)
        setStreamStatus('calling_tool')
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...lastMsg, toolCalls: [...(lastMsg.toolCalls || []), newTc] }]
          }
          return [...prev, { role: 'assistant', content: '', toolCalls: [newTc] }]
        })
      }
      if (msg.type === 'tool_result') {
        setToolCallHistory((prev) => {
          const updated = [...prev]
          const last = updated.reverse().find((t) => !t.done)
          if (last) last.done = true
          return updated
        })
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg?.role === 'assistant' && lastMsg.toolCalls?.length) {
            const updatedCalls = lastMsg.toolCalls.map((tc) =>
              !tc.done ? { ...tc, done: true, output: msg.toolOutput } : tc
            )
            return [...prev.slice(0, -1), { ...lastMsg, toolCalls: updatedCalls }]
          }
          return prev
        })
        setStreamStatus('responding')
      }
      if (msg.type === 'skill_assigned' && msg.assignedSkillId) {
        const matched = skills.find((s) => s.id === msg.assignedSkillId)
        if (matched) setActiveAgent(matched)
      }
      if (msg.type === 'complete') {
        // Flush any remaining thinking content
        const remainingThinking = thinkingContentRef.current
        thinkingContentRef.current = ''
        if (remainingThinking) {
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1]
            if (lastMsg?.role === 'assistant') {
              // If no content was set yet, put remaining thinking into content so it shows in the dialog
              if (!lastMsg.content && !lastMsg.thinking) {
                return [...prev.slice(0, -1), { ...lastMsg, content: remainingThinking }]
              }
              return [...prev.slice(0, -1), { ...lastMsg, thinking: (lastMsg.thinking || '') + remainingThinking }]
            }
            return [...prev, { role: 'assistant', content: remainingThinking }]
          })
        }
        setIsSending(false)
        setStreamStatus('idle')
        setStatusMessage('')
        currentResponseRef.current = ''
        if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null }
        if (msg.elapsed) setElapsedMs(msg.elapsed)
        if (msg.totalTokens != null) {
          setTokenStats({
            total: msg.totalTokens,
            prompt: msg.promptTokens || 0,
            completion: msg.completionTokens || 0,
          })
        }
        if (msg.contextWindow) setContextWindow(msg.contextWindow)
        if (msg.analysisId && msg.redirect) {
          setPendingAnalysis({ id: msg.analysisId, redirect: msg.redirect })
        }
        if (msg.hasStructuredResult) {
          onAnalysisComplete?.(msg.analysisId || '')
        }
      }
      if (msg.type === 'todo_list' && msg.todos) {
        setTodos(msg.todos)
        // Auto-expand the todo panel when new tasks arrive
        if (msg.todos.length > 0) {
          setTodoPanelCollapsed(false)
        }
        setTaskOutputs((prev) => {
          const keepIds = new Set(msg.todos!.map((t) => t.id))
          const next: Record<string, string> = {}
          for (const id of keepIds) {
            if (prev[id]) next[id] = prev[id]
          }
          return next
        })
      }
      if (msg.type === 'a2ui_surface' && msg.messages) {
        onA2uiSurface?.({ title: msg.title || 'AI分析结果', messages: msg.messages })
      }
      if (msg.type === 'error') {
        setIsSending(false)
        setStreamStatus('idle')
        setStatusMessage('')
        thinkingContentRef.current = ''
        setErrorMessage(msg.errorMessage || msg.content || '请求失败')
        if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null }
      }
      if (msg.type === 'stopped') {
        setIsSending(false)
        setStreamStatus('idle')
        setStatusMessage('')
        currentResponseRef.current = ''
        thinkingContentRef.current = ''
        if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null }
        if (msg.elapsed) setElapsedMs(msg.elapsed)
      }
    }
  }, [wsMessages])

  // Click outside handlers
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!modelWrapRef.current?.contains(e.target as Node)) setShowModelDropdown(false)
      // Don't close popups if click was on a toggle button
      if (target.closest('.input-skill-bar') || target.closest('.toolbar-action-btn')) return
      if (!agentPopupRef.current?.contains(e.target as Node)) { setShowAgentPopup(false); setAgentSearch('') }
      if (!quotePopupRef.current?.contains(e.target as Node)) setShowQuotePopup(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // Scroll handlers — pause auto-scroll when user manually scrolls up
  const isNearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40

  const handleTodoScroll = () => {
    const el = todoPanelRef.current
    if (!el) return
    userScrolledUpTodo.current = !isNearBottom(el)
  }

  const handleChatScroll = () => {
    const el = chatMessagesRef.current
    if (!el) return
    userScrolledUpChat.current = !isNearBottom(el)
  }

  // Auto-scroll todo panel when task outputs or todos change
  useEffect(() => {
    const el = todoPanelRef.current
    if (!el || userScrolledUpTodo.current) return
    el.scrollTop = el.scrollHeight
  }, [taskOutputs, todos])

  // Auto-scroll chat messages when content changes
  useEffect(() => {
    const el = chatMessagesRef.current
    if (!el || userScrolledUpChat.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamStatus])

  // Auto-scroll editor when content changes
  useEffect(() => {
    const el = editorScrollRef.current
    if (!el || userScrolledUpEditor.current) return
    el.scrollTop = el.scrollHeight
  }, [editorBlocks])

  // Reset scroll state when sending a new message
  useEffect(() => {
    if (isSending) {
      userScrolledUpChat.current = false
      userScrolledUpTodo.current = false
      userScrolledUpEditor.current = false
      setLocalTab('chat')
    }
  }, [isSending])

  // Resize handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return
      const delta = resizeStartX.current - e.clientX
      const newWidth = Math.min(Math.round(window.innerWidth * 0.5), Math.max(320, resizeStartWidth.current + delta))
      setRightPanelWidth(newWidth)
    }
    function onMouseUp() {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = rightPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const doSend = useCallback((message: string, opts?: { taskId?: string; orders?: string[] }) => {
    if (isSending) return
    setIsSending(true)
    setStreamStatus('thinking')
    setStatusMessage('')
    setElapsedMs(0)
    setTokenStats(null)
    setContextWindow(null)
    setErrorMessage(null)
    setToolCallHistory([])
    setTodos([])
    setTaskOutputs({})
    currentResponseRef.current = ''
    thinkingContentRef.current = ''

    const start = Date.now()
    if (elapsedTimer.current) clearInterval(elapsedTimer.current)
    elapsedTimer.current = setInterval(() => setElapsedMs(Date.now() - start), 200)

    const orderIds = opts?.orders && opts.orders.length > 0 ? opts.orders : undefined
    const quote = quotedMessage
    const fullMessage = quote
      ? `[引用AI回复]\n${quote.content}\n\n---\n${message}`
      : message
    const displayMsg = orderIds
      ? `【已选合同：${orderIds.join('、')}】\n${fullMessage}`
      : fullMessage
    setMessages((prev) => [...prev, { role: 'user', content: displayMsg }])
    if (orderIds) onClearOrders?.()
    setQuotedMessage(null)
    api.chat.save(sessionId, 'user', fullMessage).catch(() => {})
    wsSend({
      type: 'chat',
      sessionId,
      skillId: autoAssign ? undefined : activeAgent?.id,
      autoAssign: autoAssign || undefined,
      model: selectedModelId,
      message: fullMessage,
      taskId: opts?.taskId,
      orders: orderIds,
    })
  }, [isSending, autoAssign, activeAgent, selectedModelId, wsSend, onClearOrders, sessionId, quotedMessage])

  // Register sendMessage in the store so pages can trigger sends programmatically
  useEffect(() => {
    setSendMessage(doSend)
  }, [doSend, setSendMessage])

  // Also expose via ref for backward compatibility
  useImperativeHandle(ref, () => ({
    sendMessage: doSend,
  }), [doSend])

  const handleSend = () => {
    if (!chatInput.trim() || isSending) return
    if (!autoAssign && !activeAgent && !pureChat) return

    const msg = chatInput.trim()
    const orderIds = orders && orders.length > 0 ? orders : undefined
    doSend(msg, { orders: orderIds })
    setChatInput('')
  }

  const handleStop = () => {
    wsSend({ type: 'abort', sessionId })
    setIsSending(false)
    setStreamStatus('idle')
    setStatusMessage('')
    currentResponseRef.current = ''
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null }
  }

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return `${mins}m ${secs}s`
  }
  const formatTokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  const handleNewConversation = () => {
    setMessages([])
    setTodos([])
    setTaskOutputs({})
    setStreamStatus('idle')
    setStatusMessage('')
    setTokenStats(null)
    setErrorMessage(null)
    currentResponseRef.current = ''
    thinkingContentRef.current = ''
    setExpandedThinking(new Set())
    setLocalTab('chat')
    setEditorLang('')
  }

  const panelContent = (
    <>
      {/* Header */}
      <div className="panel-header">
        <div className="panel-title">
          <span className="panel-title-dot" />
          AI专属助手
        </div>
        {tabs && onTabChange && (
          <div className="panel-tabs">
            {tabs.filter(t => !t.hidden).map((tab) => (
              <button
                key={tab.key}
                className={cn('panel-tab', activeTab === tab.key && 'active')}
                onClick={() => onTabChange(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {/* Local tabs: 对话 / 编辑器 */}
        {hasEditorBlocks && (
          <div className="panel-tabs panel-local-tabs">
            <button
              className={cn('panel-tab', localTab === 'chat' && 'active')}
              onClick={() => setLocalTab('chat')}
            >
              对话
            </button>
            <button
              className={cn('panel-tab', localTab === 'editor' && 'active')}
              onClick={() => setLocalTab('editor')}
            >
              编辑器
            </button>
          </div>
        )}
        <button className="panel-new-chat-btn" title="新建对话" onClick={handleNewConversation}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="2" y="2" width="10" height="10" rx="2"/><path d="M7 5v4M5 7h4"/>
          </svg>
        </button>
        <button className="panel-history-btn" title="历史对话" onClick={() => setShowHistory(!showHistory)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="5.5"/><path d="M7 4v3.5L9 9"/>
          </svg>
        </button>
        <button className="panel-collapse-btn" title="收起" onClick={() => setCollapsed(!collapsed)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M7 2l4 4-4 4-1-1 3-3-3-3z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="panel-body">
        {showChat && localTab === 'editor' && hasEditorBlocks ? (
          <div className="chat-editor-view" ref={editorScrollRef} onScroll={() => {
            const el = editorScrollRef.current
            if (el) userScrolledUpEditor.current = el.scrollHeight - el.scrollTop - el.clientHeight > 40
          }}>
            {(() => {
              // Group blocks by language
              const flatBlocks = editorBlocks.flatMap((b) => {
                try {
                  const formatted = JSON.stringify(JSON.parse(b.code), null, 2)
                  return [{ ...b, code: formatted }]
                } catch {
                  return [b]
                }
              })
              // Get unique languages preserving order
              const seen = new Set<string>()
              const languages = flatBlocks.reduce<string[]>((acc, b) => {
                if (!seen.has(b.lang)) { seen.add(b.lang); acc.push(b.lang) }
                return acc
              }, [])
              const activeLang = editorLang || languages[0] || ''
              const filtered = flatBlocks.filter(b => b.lang === activeLang)
              return (
                <>
                  {languages.length > 1 && (
                    <div className="chat-editor-tabs">
                      {languages.map((lang) => (
                        <button
                          key={lang}
                          className={cn('chat-editor-tab', activeLang === lang && 'active')}
                          onClick={() => setEditorLang(lang)}
                        >
                          {lang || 'text'}
                        </button>
                      ))}
                    </div>
                  )}
                  {filtered.map((block, bi) => (
                    <div key={bi} className="chat-editor-block">
                      <div className="chat-editor-block-header">
                        <span className="chat-editor-block-lang">{block.lang || 'text'}</span>
                        <span className="chat-editor-block-msg">消息 #{block.msgIdx + 1}</span>
                      </div>
                      <pre className="chat-editor-code">
                        <code>{block.code}</code>
                      </pre>
                    </div>
                  ))}
                </>
              )
            })()}
          </div>
        ) : !showChat && detailSlot ? (
          detailSlot
        ) : messagesLoading ? (
          <div className="chat-empty">
            <div className="chat-empty-label">加载历史对话...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-img">
              <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 48, height: 48 }}>
                <rect x="8" y="12" width="48" height="36" rx="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
                <path d="M20 24h24M20 32h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
                <circle cx="48" cy="42" r="10" fill="var(--color-accent-bg)" stroke="var(--color-accent)" strokeWidth="1.5" />
                <path d="M44 42h8M48 38v8" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M28 48l-6 6v-6H8a2 2 0 01-2-2V8a2 2 0 012-2h48a2 2 0 012 2v24" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.12" />
              </svg>
            </div>
            <div className="chat-empty-label">别来无恙！</div>
            <div className="chat-empty-sub">
              选择订单加入对话，<br />或直接向助手提问。
            </div>
          </div>
        ) : (
          <div className="chat-messages" ref={chatMessagesRef} onScroll={handleChatScroll}>
            {messages.map((msg, i) => (
              <div key={i} className={cn('chat-msg-row', msg.role)}>
                <div className={cn('chat-msg-avatar', msg.role)}>
                  {msg.role === 'user' ? '我' : (() => { const Icon = getSkillIcon(activeAgent?.icon || 'bot'); return <Icon size={13} strokeWidth={2.5} />; })()}
                </div>
                <div className="chat-msg-body">
                  <div className="chat-msg-name">
                    {msg.role === 'user' ? '用户' : (activeAgent?.name || 'AI 助手')}
                  </div>
                  <div className={cn('chat-msg-bubble', msg.role)}>
                    {/* Thinking block */}
                    {msg.role === 'assistant' && msg.thinking && (
                      <div className="chat-thinking-block">
                        <button
                          className="chat-thinking-header"
                          onClick={() => setExpandedThinking((prev) => {
                            const next = new Set(prev)
                            if (next.has(i)) next.delete(i); else next.add(i)
                            return next
                          })}
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                            style={{ transform: expandedThinking.has(i) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                          >
                            <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                          <span>思考过程</span>
                        </button>
                        {expandedThinking.has(i) && (
                          <div className="chat-thinking-content">
                            {msg.thinking}
                          </div>
                        )}
                      </div>
                    )}
                    {/* CLI / Tool call blocks */}
                    {msg.role === 'assistant' && msg.toolCalls?.map((tc, tci) => (
                      <div key={tci} className={cn('chat-cli-block', tc.done && 'done')}>
                        <div className="chat-cli-header">
                          <span className="chat-cli-prompt">$</span>
                          <span className="chat-cli-cmd">{tc.label || tc.name}</span>
                          {tc.done && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="chat-cli-check">
                              <circle cx="5" cy="5" r="4.5" fill="#22c55e" stroke="#22c55e" strokeWidth="1" />
                              <path d="M3 5l1.5 1.5L7 4" stroke="#fff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {!tc.done && <span className="chat-cli-running">执行中…</span>}
                        </div>
                        {tc.output && (
                          <div className="chat-cli-output">
                            <pre>{tc.output}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                    {msg.content && <MarkdownRenderer content={msg.content} />}
                  </div>
                </div>
              </div>
            ))}
            {streamStatus !== 'idle' && streamStatus !== 'responding' && (
              <div className="chat-msg-row assistant" style={{ opacity: 0.7 }}>
                <div className={cn('chat-msg-avatar', 'assistant')}>
                  {(() => { const Icon = getSkillIcon(activeAgent?.icon || 'bot'); return <Icon size={13} strokeWidth={2.5} />; })()}
                </div>
                <div className="chat-msg-body">
                  <div className="chat-msg-name">{activeAgent?.name || 'AI 助手'}</div>
                  <div className="chat-msg-bubble assistant">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="thinking-dot" />
                      {streamStatus === 'thinking' && '思考中...'}
                      {streamStatus === 'calling_tool' && (statusMessage || '调用工具...')}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
            {pendingAnalysis && (
              <div className="analysis-confirm">
                <div className="analysis-confirm-header">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 12a1 1 0 110-2 1 1 0 010 2zm0-3a1 1 0 01-1-1V4a1 1 0 012 0v4a1 1 0 01-1 1z" />
                  </svg>
                  <span>分析任务已生成</span>
                </div>
                <div className="analysis-confirm-id">{pendingAnalysis.id}</div>
                <div className="analysis-confirm-desc">AI 已完成订单履约分析，识别出相关卡点与风险。</div>
                <button
                  className="analysis-confirm-btn"
                  onClick={() => {
                    if (onAnalysisNavigate && pendingAnalysis) {
                      onAnalysisNavigate(pendingAnalysis.redirect)
                    }
                    setPendingAnalysis(null)
                  }}
                >
                  查看分析结果
                </button>
              </div>
            )}
            </div>
        )}
      </div>

      {/* Task panel — fixed at bottom of dialog, above status bar */}
      {showChat && todos.length > 0 && (
        <div className="chat-task-panel">
          <div className="chat-task-panel-inner" ref={todoPanelRef} onScroll={handleTodoScroll}>
            <TodoWidget todos={todos} taskOutputs={taskOutputs} />
          </div>
        </div>
      )}

      {/* Status bar */}
      {showChat && streamStatus !== 'idle' && (
        <div className="panel-status-bar">
          <div className="psb-left">
            <span className={cn('psb-status-dot', streamStatus)} />
            <span className="psb-status-text">
              {streamStatus === 'thinking' && '思考中…'}
              {streamStatus === 'calling_tool' && statusMessage}
              {streamStatus === 'responding' && '输出中…'}
            </span>
            {toolCallHistory.length > 0 && (
              <span className="psb-tool-count">{toolCallHistory.filter(t => t.done).length}/{toolCallHistory.length} 工具</span>
            )}
          </div>
          <div className="psb-right">
            {elapsedMs > 0 && (
              <span className="psb-elapsed">{formatElapsed(elapsedMs)}</span>
            )}
          </div>
        </div>
      )}
      {showChat && streamStatus === 'idle' && tokenStats && (
        <div className="panel-status-bar done">
          <div className="psb-left">
            <span className="psb-check">&#10003;</span>
            <span className="psb-status-text">完成</span>
            {contextWindow && tokenStats.prompt > 0 && (
              <span className="psb-context" title={`上下文用量: ${formatTokens(tokenStats.prompt)} / ${formatTokens(contextWindow)}`}>
                {formatTokens(tokenStats.prompt)}/{formatTokens(contextWindow)}
              </span>
            )}
          </div>
          <div className="psb-right">
            <span className="psb-tokens">{formatTokens(tokenStats.total)} tokens</span>
            <span className="psb-elapsed">{formatElapsed(elapsedMs)}</span>
          </div>
        </div>
      )}
      {showChat && errorMessage && (
        <div className="panel-error-bar">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0 }}>
            <path d="M6 0a6 6 0 100 12A6 6 0 006 0zm0 9a.75.75 0 110-1.5.75.75 0 010 1.5zm0-2.25a.75.75 0 01-.75-.75V3a.75.75 0 011.5 0v3a.75.75 0 01-.75.75z" />
          </svg>
          <span className="panel-error-text">{errorMessage}</span>
          <button className="panel-error-dismiss" onClick={() => setErrorMessage(null)} title="关闭">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M1.5 1.5l7 7m-7 0l7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Footer */}
      {showChat && (
        <div className="panel-footer">
          <div className="chat-input-box">
            {/* Skill selector bar — click to switch */}
            {!lockAgent && (
              <button className="input-skill-bar" onClick={() => setShowAgentPopup(!showAgentPopup)}>
                <span className={cn('skill-dot', activeAgent?.color)} />
                <span className="input-skill-name">
                  {autoAssign ? '自动分配' : activeAgent?.name || '选择智能体'}
                </span>
                <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="input-skill-chevron">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            )}
            {orders && orders.length > 0 && (
              <div className="chat-order-chips">
                {orders.map((id) => (
                  <span key={id} className="chat-order-chip">{id}</span>
                ))}
                {onClearOrders && (
                  <button className="chat-order-clear" onClick={onClearOrders} title="清除已选合同">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <path d="M1.5 1.5l7 7m-7 0l7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            {quotedMessage && (
              <div className="chat-quote-chip-wrap">
                <span className="chat-quote-chip">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M2 3h6M2 5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                  </svg>
                  引用AI回复
                </span>
                <button className="chat-order-clear" onClick={() => setQuotedMessage(null)} title="取消引用">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                    <path d="M1.5 1.5l7 7m-7 0l7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
            {footerSlot}
            <textarea
              className="chat-textarea"
              placeholder="输入消息..."
              value={chatInput}
              disabled={isSending}
              onChange={(e) => setChatInput(e.target.value)}
              onCompositionStart={() => { isComposingRef.current = true }}
              onCompositionEnd={() => { isComposingRef.current = false }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (isComposingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <div className="chat-toolbar">
              <div className="chat-toolbar-left">
                <button className="toolbar-action-btn" title="切换智能体" onClick={() => !lockAgent && setShowAgentPopup(!showAgentPopup)}>
                  @
                </button>
                <button
                  className={cn('toolbar-action-btn', quotedMessage && 'active')}
                  title="引用对话"
                  onClick={() => setShowQuotePopup(!showQuotePopup)}
                >
                  #
                </button>
              </div>
              <div className="chat-toolbar-right">
                <div
                  ref={modelWrapRef}
                  className={cn('model-select-wrap', showModelDropdown && 'open')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowModelDropdown(!showModelDropdown)
                  }}
                >
                  <span className="model-label">{selectedModelId || '选择模型'}</span>
                  <span className="model-chevron">
                    <svg width="9" height="5" viewBox="0 0 9 5" fill="currentColor">
                      <path d="M0 0l4.5 5L9 0z" />
                    </svg>
                  </span>
                  <div className={cn('model-dropdown', showModelDropdown && 'show')}>
                    {models.map((m) => (
                      <div
                        key={m.id}
                        className={cn('model-dropdown-item', selectedModelId === m.id && 'active')}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedModelId(m.id)
                          setShowModelDropdown(false)
                        }}
                      >
                        <div className="mi-icon" style={{ background: MODEL_COLORS[m.provider] || '#666' }}>{MODEL_ICONS[m.provider] || 'L'}</div>
                        <span className="mi-name">{m.name}</span>
                        <span className="mi-tag">{m.tag}</span>
                        {selectedModelId === m.id && (
                          <span className="mi-check">
                            <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
                              <path d="M1 5l4 4L11 1" />
                            </svg>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {isSending ? (
                  <button className="stop-btn" onClick={handleStop} title="中止对话">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <rect x="1" y="1" width="10" height="10" rx="1" />
                    </svg>
                    中止
                  </button>
                ) : (
                  <button className="send-btn" onClick={handleSend} disabled={!autoAssign && !activeAgent && !pureChat}>
                    发送
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quote Popup — select AI response to reference */}
          {showQuotePopup && (
            <div ref={quotePopupRef} className="quote-popup">
              <div className="quote-popup-header">
                <span>引用AI回复</span>
                <button className="quote-popup-close" onClick={() => setShowQuotePopup(false)}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M1.5 1.5l9 9m-9 0l9-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="quote-popup-list">
                {(() => {
                  const assistantMsgs = messages
                    .map((m, i) => ({ ...m, _idx: i }))
                    .filter((m) => m.role === 'assistant' && m.content)
                    .reverse()
                  if (assistantMsgs.length === 0) {
                    return <div className="quote-popup-empty">暂无AI回复</div>
                  }
                  return assistantMsgs.map((msg) => {
                    const preview = msg.content.slice(0, 150).replace(/\n/g, ' ')
                    const isSelected = quotedMessage?.index === msg._idx
                    // Detect if message contains code blocks or links
                    const hasCode = /```/.test(msg.content)
                    const hasLink = /https?:\/\//.test(msg.content)
                    return (
                      <div
                        key={msg._idx}
                        className={cn('quote-popup-item', isSelected && 'selected')}
                        onClick={() => {
                          if (isSelected) {
                            setQuotedMessage(null)
                          } else {
                            setQuotedMessage({ index: msg._idx, content: msg.content })
                            setShowQuotePopup(false)
                          }
                        }}
                      >
                        <div className="quote-popup-item-idx">#{messages.length - msg._idx}</div>
                        <div className="quote-popup-item-body">
                          <div className="quote-popup-item-preview">{preview}{msg.content.length > 150 ? '…' : ''}</div>
                          <div className="quote-popup-item-meta">
                            {hasCode && <span className="quote-meta-tag">含代码</span>}
                            {hasLink && <span className="quote-meta-tag">含链接</span>}
                            <span>{msg.content.length > 500 ? '长文本' : '短文本'}</span>
                          </div>
                        </div>
                        {isSelected && (
                          <span className="quote-popup-item-check">
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l3 3L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}

          {/* Agent Popup */}
          {!lockAgent && (
            <div ref={agentPopupRef} className={cn('agent-popup', showAgentPopup && 'show')}>
              <div className="agent-popup-handle">
                <div className="agent-popup-handle-bar" />
              </div>
              <div className="agent-popup-inner">
                <div className="agent-popup-header">
                  <div className="agent-popup-title">选择智能体</div>
                  <div className="toggle-wrap">
                    <span className="toggle-label">自动分配</span>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={autoAssign}
                        onChange={(e) => setAutoAssign(e.target.checked)}
                      />
                      <span className="toggle-track" />
                      <span className="toggle-thumb" />
                    </label>
                  </div>
                </div>
                {!autoAssign && (
                  <>
                    {/* Search input */}
                    <div className="agent-search-wrap">
                      <span className="agent-search-icon">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <circle cx="5" cy="5" r="3.5"/><path d="M7.5 7.5L10 10"/>
                        </svg>
                      </span>
                      <input
                        className="agent-search-input"
                        type="text"
                        placeholder="检索智能体..."
                        value={agentSearch}
                        onChange={(e) => setAgentSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="agent-list">
                      {/* Pure chat option */}
                      {(!agentSearch || '纯对话'.includes(agentSearch) || 'no skill'.includes(agentSearch.toLowerCase())) && (
                        <div
                          className={cn('agent-item', 'pure-chat', pureChat && 'active')}
                          onClick={() => {
                            setActiveAgent(null)
                            setPureChat(true)
                            setShowAgentPopup(false)
                            setAgentSearch('')
                          }}
                        >
                          <div className="agent-item-icon">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M2 3h8M2 6h8M2 9h5"/>
                            </svg>
                          </div>
                          <div className="agent-item-body">
                            <div className="agent-item-label">纯对话</div>
                            <div className="agent-item-sub">不使用技能，直接与 AI 对话</div>
                          </div>
                          {pureChat && (
                            <div className="agent-item-check">
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4l3 3L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )}
                      {skillsLoading ? (
                        <div style={{ padding: 12, color: 'var(--color-muted)', fontSize: 12, textAlign: 'center' }}>加载中...</div>
                      ) : skills.length === 0 ? (
                        <div style={{ padding: 12, color: 'var(--color-muted)', fontSize: 12, textAlign: 'center' }}>暂无智能体</div>
                      ) : (
                        skills.filter((s) => {
                          if (!agentSearch) return true
                          const q = agentSearch.toLowerCase()
                          return s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q))
                        }).map((agent) => (
                          <div
                            key={agent.id}
                            className="agent-item"
                            onClick={() => {
                              setActiveAgent(agent)
                              setPureChat(false)
                              setShowAgentPopup(false)
                              setAgentSearch('')
                            }}
                          >
                            <div className={cn('agent-item-icon', agent.color)}>
                              {(() => { const Icon = getSkillIcon(agent.icon); return <Icon size={11} strokeWidth={2.5} />; })()}
                            </div>
                            <div className="agent-item-body">
                              <div className="agent-item-label">{agent.name}</div>
                              <div className="agent-item-sub">{agent.description}</div>
                            </div>
                            {activeAgent?.id === agent.id && (
                              <div className="agent-item-check">
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                  <path d="M1 4l3 3L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                      {!skillsLoading && agentSearch && skills.filter((s) => {
                        const q = agentSearch.toLowerCase()
                        return s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q))
                      }).length === 0 && (
                        <div style={{ padding: 12, color: 'var(--color-muted)', fontSize: 12, textAlign: 'center' }}>无匹配的智能体</div>
                      )}
                    </div>
                  </>
                )}
                {autoAssign && (
                  <div className="agent-auto-desc">
                    由系统自动识别对话意图并分配最合适的智能体处理
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <>
      {/* Resize Handle */}
      {!collapsed && (
        <div className="panel-resize-handle" onMouseDown={handleResizeStart} title="拖动调整面板宽度" />
      )}

      {/* Right Panel */}
      {!collapsed && (
        <aside className="right-panel" style={{ width: rightPanelWidth }}>
          {panelContent}
        </aside>
      )}

      {/* Collapsed toggle */}
      {collapsed && (
        <button className="panel-expand-btn" onClick={() => setCollapsed(false)} title="展开AI助手">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M5 2l6 5-6 5-1-1 5-4-5-4z" />
          </svg>
          <span className="panel-expand-label">AI</span>
        </button>
      )}
    </>
  )
})

export default ChatPanel
