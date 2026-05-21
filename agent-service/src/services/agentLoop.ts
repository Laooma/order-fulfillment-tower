import { WebSocket } from 'ws'
import type { Session, Skill, Hook, AgentMessage, TodoItem } from '../types'
import { streamChat, chatCompletion } from './llmEngine'
import type { McpPool } from './mcpPool'
import { SessionStore } from './sessionStore'
import { getProviderForModel, getDefaultModel, getAllModels } from './llmConfig'
import { loadSkills, createSkill, saveSkill, saveSkillFile } from './skillLoader'
import { loadHooks, createHook, saveHook } from './hookLoader'
import { runHooks } from './hookRunner'

const sessions = new Map<string, Session>()
const todoStores = new Map<string, TodoItem[]>()
const sessionLocks = new Map<string, Promise<void>>()
const sessionAborts = new Map<string, AbortController>()

// Pool and store references (set via initAgentLoop)
let mcpPool: McpPool | null = null
let sessionStore: SessionStore | null = null

export function initAgentLoop(pool: McpPool, store: SessionStore): void {
  mcpPool = pool
  sessionStore = store
  store.setSessionsRef(sessions)
}

// Helper: push message and persist to DB
function pushMessage(key: string, session: Session, message: Session['messages'][0]): void {
  session.messages.push(message)
  if (sessionStore) {
    sessionStore.appendMessage(key, message)
  }
}

// Helper: track tokens and check compaction after LLM call
async function trackTokensAndCompact(key: string, session: Session, promptTokens: number, modelId: string): Promise<void> {
  if (!sessionStore) return
  sessionStore.addInputTokens(key, promptTokens)
  session.cumulativeInputTokens += promptTokens

  if (sessionStore.shouldCompact(key)) {
    try {
      const { getProviderForModel } = await import('./llmConfig.js')
      const provider = getProviderForModel(modelId)
      const result = await sessionStore.compactSession(key, provider ? async (messages, prevSummary) => {
        const { chatCompletion } = await import('./llmEngine.js')
        const resp = await chatCompletion({
          model: modelId,
          messages: [
            { role: 'system', content: SUMMARIZATION_PROMPT },
            { role: 'user', content: formatMessagesForSummary(messages, prevSummary) },
          ],
          temperature: 0.3,
        }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })
        return resp.content || ''
      } : undefined)
      console.log(`[AgentLoop] Session ${key} compacted: removed ${result.removedCount} messages`)
      // Refresh session messages from store
      const updated = sessionStore.getSession(key)
      if (updated) session.messages = updated.messages
    } catch (err) {
      console.error('[AgentLoop] Compaction failed:', err)
    }
  }
}

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Summarize the following conversation messages into a structured summary.

Format your summary exactly as:
Conversation summary:
- Scope: X user messages, Y assistant messages, Z tool calls.
- Tools mentioned: comma-separated list of unique tool names.
- Recent user requests: up to 3, each under 160 chars.
- Pending work: items inferred from keywords (todo, next, pending, follow up, remaining).
- Key files referenced: up to 8 file paths.
- Current work: what was most recently being worked on.
- Key timeline: one line per message, "role: truncated content".

Keep the summary under 1200 characters and 24 lines. Each line under 160 characters.`

function formatMessagesForSummary(messages: Session['messages'], prevSummary?: string): string {
  let text = ''
  if (prevSummary) text += `Previous summary:\n${prevSummary}\n\n`
  text += 'Messages to summarize:\n'
  for (const m of messages) {
    const content = m.content.slice(0, 500)
    const toolInfo = m.toolCalls?.map(tc => tc.function.name).join(', ')
    text += `[${m.role}]${toolInfo ? ` (tools: ${toolInfo})` : ''} ${content}\n`
  }
  return text
}
const MAX_ITERATIONS = 8
const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'

// Built-in todo_write tool definition (Claude Code compatible)
const TODO_WRITE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'todo_write',
    description: 'Use this tool to create and manage a structured task list for your current workflow. This helps track progress, organize complex tasks, and demonstrate thoroughness. You should first list all tasks, then work through them one by one, updating each task status as you go.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the task (e.g. "1", "2")' },
              content: { type: 'string', description: 'Description of what needs to be done' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current status: pending (not started), in_progress (currently working on), completed (finished)' },
            },
            required: ['id', 'content', 'status'],
          },
          description: 'The full list of todos with their current statuses',
        },
      },
      required: ['todos'],
    },
  },
}

// Built-in save_skill tool — saves a new skill .md file to the skills directory
const SAVE_SKILL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_skill',
    description: 'Save a new skill (or update an existing one) to the skills directory. The skill will be immediately available for use. Use this when you have generated a complete skill definition (.md file with YAML frontmatter).',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'Skill ID (filename without .md, e.g. "contract-risk-warning")' },
        name: { type: 'string', description: 'Display name of the skill (e.g. "合同风险预警助手")' },
        description: { type: 'string', description: 'One-line description of what the skill does' },
        icon: { type: 'string', description: 'Icon name: clipboard-check, circle-dollar-sign, building, package-search, or bot' },
        color: { type: 'string', description: 'Color: ai-purple, ai-blue, ai-green, or ai-orange' },
        prompt: { type: 'string', description: 'The skill body (system prompt content, WITHOUT the YAML frontmatter — just the markdown body after the --- block)' },
        references: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, description: 'Optional reference files (markdown docs)' },
        scripts: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, description: 'Optional script files (bash/python)' },
      },
      required: ['skillId', 'name', 'description', 'icon', 'color', 'prompt'],
    },
  },
}

const SAVE_HOOK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_hook',
    description: 'Save a new hook (or update an existing one) to the hooks directory. The hook will be immediately available and executed by the agent loop on the specified event.',
    parameters: {
      type: 'object',
      properties: {
        hookId: { type: 'string', description: 'Hook ID (filename without .json, e.g. "log-chat")' },
        name: { type: 'string', description: 'Display name of the hook' },
        description: { type: 'string', description: 'One-line description of what the hook does' },
        event: { type: 'string', enum: ['before_chat', 'after_chat', 'before_tool_call', 'after_tool_call', 'on_error'], description: 'The event that triggers this hook' },
        script: { type: 'string', description: 'The shell script to execute (bash/sh). Receives context via HOOK_CONTEXT env var and stdin JSON.' },
        enabled: { type: 'boolean', description: 'Whether the hook is enabled (default true)' },
        matcher: { type: 'string', description: 'Optional regex to match tool name or skill name. Use * to match all.' },
      },
      required: ['hookId', 'name', 'description', 'event', 'script'],
    },
  },
}

const SEND_NOTIFICATION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'send_notification',
    description: 'Send a notification message through a configured notification channel (email, WeCom bot, or Feishu bot). Use this to notify users about important events like analysis completion, overdue tasks, or status changes.',
    parameters: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The ID of the notification channel to use. Call list_notification_channels first to see available channels.' },
        to: { type: 'string', description: 'Recipient address. For email: comma-separated email addresses. For WeCom/Feishu bots: can be empty (webhook determines the destination).' },
        subject: { type: 'string', description: 'Message subject (used for email, ignored for bots)' },
        message: { type: 'string', description: 'Message body content. Plain text. For WeCom bots, markdown format is supported.' },
      },
      required: ['channelId', 'message'],
    },
  },
}

const LIST_NOTIFICATION_CHANNELS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_notification_channels',
    description: 'List all configured notification channels (email, WeCom bot, Feishu bot). Use this to discover available channels before sending a notification.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

const SHOW_ANALYSIS_RESULT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'show_analysis_result',
    description: '【仅限可视化请求】当且仅当用户的请求中明确包含"生成图表"、"可视化"、"展示看板"、"生成分析页面"、"用图表展示"、"生成仪表盘"等明确要求可视化输出时，才调用此工具。对于普通的文字分析、数据查询、状态检查等不需要可视化界面的请求，千千千万万万不要调用此工具。调用后会在界面中展示一个可视化分析结果面板。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '分析结果页面的标题，显示在标签页上' },
        a2uiMessages: {
          type: 'array',
          description: 'A2UI v0.9 格式的 UI 消息数组。包含 createSurface（创建渲染表面）、updateComponents（定义组件树）和 updateDataModel（填充数据）三种消息类型。',
          items: { type: 'object' },
        },
      },
      required: ['title', 'a2uiMessages'],
    },
  },
}

function handleShowAnalysisResult(args: Record<string, unknown>, sessionId: string, ws: WebSocket): string {
  const title = String(args.title || 'AI分析结果')
  const a2uiMessages = args.a2uiMessages

  if (!Array.isArray(a2uiMessages) || a2uiMessages.length === 0) {
    return 'Error: a2uiMessages is required and must be a non-empty array'
  }

  send(ws, {
    type: 'a2ui_surface',
    sessionId,
    title,
    messages: a2uiMessages,
  })

  return `分析结果页面"${title}"已生成并展示在"AI分析结果"标签页中。用户可在页面顶部切换到此标签页查看可视化分析内容。`
}

function handleSaveHook(args: Record<string, unknown>): string {
  try {
    const hookId = String(args.hookId || '')
    const name = String(args.name || '')
    const description = String(args.description || '')
    const event = String(args.event || 'before_chat') as Hook['event']
    const script = String(args.script || '')
    const enabled = args.enabled !== false
    const matcher = String(args.matcher || '*')

    if (!hookId || !name || !script) {
      return 'Error: hookId, name, and script are required'
    }

    const existing = loadHooks().find((h) => h.id === hookId)
    if (existing) {
      saveHook(hookId, { name, description, event, script, enabled, matcher })
      return `Hook "${name}" (${hookId}) has been updated successfully. It will trigger on "${event}" events.`
    }

    createHook(hookId, { name, description, event, script, enabled, matcher })
    return `Hook "${name}" (${hookId}) has been created successfully and saved to the hooks directory. It will trigger on "${event}" events.`
  } catch (err: any) {
    return `Error saving hook: ${err.message}`
  }
}

function handleSaveSkill(args: Record<string, unknown>): string {
  try {
    const skillId = String(args.skillId || '')
    const name = String(args.name || '')
    const description = String(args.description || '')
    const icon = String(args.icon || 'bot')
    const color = String(args.color || 'ai-purple')
    const prompt = String(args.prompt || '')

    if (!skillId || !name || !prompt) {
      return 'Error: skillId, name, and prompt are required'
    }

    // Check if skill already exists
    const existing = loadSkills().find((s) => s.id === skillId)
    if (existing) {
      // Update existing skill
      const frontmatter = `---
name: ${name}
description: ${description}
icon: ${icon}
color: ${color}
---

${prompt}`
      saveSkill(skillId, frontmatter)
      return `Skill "${name}" (${skillId}) has been updated successfully. The skill is now available for use.`
    }

    createSkill(skillId, { name, description, icon, color }, prompt)
    // Save reference files
    const references = args.references as Array<{ path: string; content: string }> | undefined
    if (references && Array.isArray(references)) {
      for (const ref of references) {
        if (ref.path && ref.content) {
          saveSkillFile(skillId, `references/${ref.path}`, ref.content)
        }
      }
    }

    // Save script files
    const scripts = args.scripts as Array<{ path: string; content: string }> | undefined
    if (scripts && Array.isArray(scripts)) {
      for (const sc of scripts) {
        if (sc.path && sc.content) {
          saveSkillFile(skillId, `scripts/${sc.path}`, sc.content)
        }
      }
    }

    return `Skill "${name}" (${skillId}) has been created successfully and saved to the skills directory. The skill is now available for use.`
  } catch (err: any) {
    return `Error saving skill: ${err.message}`
  }
}

async function handleSendNotification(args: Record<string, unknown>): Promise<string> {
  try {
    const channelId = String(args.channelId || '')
    const to = String(args.to || '')
    const subject = String(args.subject || '')
    const message = String(args.message || '')

    if (!channelId || !message) {
      return 'Error: channelId and message are required'
    }

    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    const response = await fetch(`${BACKEND_API}/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, to, subject, message }),
    })

    const result = await response.json() as any
    if (result.success) {
      return `Notification sent successfully via channel "${channelId}".${result.detail ? ' ' + result.detail : ''}`
    }
    return `Failed to send notification: ${result.error || 'Unknown error'}`
  } catch (err: any) {
    return `Error sending notification: ${err.message}`
  }
}

async function handleListNotificationChannels(): Promise<string> {
  try {
    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    const response = await fetch(`${BACKEND_API}/notification-channels`)
    const result = await response.json() as any
    const channels = result.data || []
    if (channels.length === 0) return 'No notification channels configured.'
    const list = channels.map((c: any) => `- ${c.id}: ${c.name} (type: ${c.type}, enabled: ${c.enabled ? 'yes' : 'no'})`).join('\n')
    return `Available notification channels:\n${list}`
  } catch (err: any) {
    return `Error listing notification channels: ${err.message}`
  }
}

function getActiveTaskId(sessionId: string): string | undefined {
  const todos = todoStores.get(sessionId)
  return todos?.find(t => t.status === 'in_progress')?.id
}

function handleTodoWrite(args: Record<string, unknown>, sessionId: string, ws: WebSocket): string {
  try {
    const todos = args.todos as TodoItem[]
    if (!todos || !Array.isArray(todos)) return 'Error: missing todos array'

    const existing = todoStores.get(sessionId) || []
    const merged = [...existing]

    for (const item of todos) {
      const idx = merged.findIndex((t) => t.id === item.id)
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...item }
      } else {
        merged.push(item)
      }
    }

    todoStores.set(sessionId, merged)
    send(ws, { type: 'todo_list', sessionId, todos: merged })

    const counts = { pending: 0, in_progress: 0, completed: 0 }
    for (const t of merged) {
      if (t.status === 'pending') counts.pending++
      if (t.status === 'in_progress') counts.in_progress++
      if (t.status === 'completed') counts.completed++
    }

    return `Todo list updated. ${counts.completed} completed, ${counts.in_progress} in progress, ${counts.pending} pending.`
  } catch (err: any) {
    return `Error: ${err.message}`
  }
}

async function saveChatHistory(sessionId: string, messages: Array<{ role: string; content: string }>) {
  try {
    await fetch(`${BACKEND_API}/chat/${sessionId}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
  } catch (err) {
    console.error('[AgentLoop] Failed to save chat history:', err)
  }
}

export function getOrCreateSession(sessionId: string, skillId: string, systemPrompt: string): Session {
  const key = `${sessionId}:${skillId}`
  if (!sessions.has(key)) {
    // Try to load from DB first
    if (sessionStore) {
      const stored = sessionStore.getSession(key)
      if (stored) {
        sessions.set(key, stored)
        return stored
      }
    }
    // Create new session
    let session: Session
    if (sessionStore) {
      session = sessionStore.createSession(key, sessionId, skillId, systemPrompt)
    } else {
      session = {
        id: sessionId,
        skillId,
        messages: [{ role: 'system', content: systemPrompt }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workDir: '',
        cumulativeInputTokens: 0,
        compactionCount: 0,
      }
    }
    sessions.set(key, session)
  }
  return sessions.get(key)!
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function abortSession(sessionId: string): void {
  sessionAborts.get(sessionId)?.abort()
}

// A2UI visualization trigger keywords
const A2UI_VISUAL_KEYWORDS = [
  '生成图表', '可视化', '看板', '仪表盘', '展示看板', '分析页面', '生成页面',
  '图表展示', '统计图', '用图表', '用图展示', '数据看板', 'dashboard', 'chart',
  'visualize', 'graph', '数据可视化', '报表', '趋势图',
]

// Analysis task creation trigger keywords
const ANALYSIS_TASK_KEYWORDS = [
  '分析', '创建分析', '生成报告', '履约分析', '订单分析', '诊断', '风险评估',
  '深度分析', '对比分析', '统计分析', '汇总',
]

function shouldEnableA2ui(userMessage: string, skill: Skill | null): boolean {
  // Skill explicitly declares A2UI requirement
  if (skill?.prompt) {
    const sp = skill.prompt.toLowerCase()
    if (sp.includes('requires_a2ui')) return true
  }
  // Check user message for visualization keywords
  const msg = userMessage.toLowerCase()
  for (const kw of A2UI_VISUAL_KEYWORDS) {
    if (msg.includes(kw.toLowerCase())) return true
  }
  // Check if skill prompt mentions A2UI/visualization support
  if (skill?.prompt) {
    const sp = skill.prompt.toLowerCase()
    if (sp.includes('a2ui') || sp.includes('可视化输出') || sp.includes('图表展示') || sp.includes('show_analysis')) {
      return true
    }
  }
  return false
}

function shouldCreateAnalysisTask(userMessage: string, skill: Skill | null, orders?: string[]): boolean {
  // Skill explicitly declares analysis task requirement
  if (skill?.prompt) {
    const sp = skill.prompt.toLowerCase()
    if (sp.includes('requires_analysis_task')) return true
  }
  // When orders are selected, analysis task creation is implicit
  if (orders && orders.length > 0) return true
  // Check user message for analysis keywords
  const msg = userMessage.toLowerCase()
  for (const kw of ANALYSIS_TASK_KEYWORDS) {
    if (msg.includes(kw.toLowerCase())) return true
  }
  // Check if skill prompt mentions analysis output
  if (skill?.prompt) {
    const sp = skill.prompt.toLowerCase()
    if (sp.includes('分析') || sp.includes('报告') || sp.includes('诊断')) {
      return true
    }
  }
  return false
}

async function fetchOrderData(orderIds: string[]): Promise<string> {
  if (orderIds.length === 0) return ''
  try {
    const res = await fetch(`${BACKEND_API}/orders?page=1&pageSize=100`)
    if (!res.ok) return ''
    const { data } = await res.json()
    const relevant = data.filter((o: any) => orderIds.includes(o.id))
    if (relevant.length === 0) return ''
    return JSON.stringify(relevant, null, 2)
  } catch {
    return ''
  }
}

async function createAnalysisTask(title: string, agentName: string, orders: string[]): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`${BACKEND_API}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, orders, agent: agentName }),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function recognizeIntent(
  message: string,
  skills: Skill[],
  modelId: string,
): Promise<Skill | null> {
  if (skills.length === 0) return null
  if (skills.length === 1) return skills[0]

  const skillList = skills.map((s, i) => `${i + 1}. ${s.name} (${s.id}): ${s.description}`).join('\n')
  const provider = getProviderForModel(modelId)
  if (!provider) return skills[0]

  try {
    const { chatCompletion } = await import('./llmEngine.js')
    const response = await chatCompletion({
      model: modelId,
      messages: [
        {
          role: 'system',
          content: `你是一个意图分类器。根据用户的消息，从以下智能体中选择最合适的一个来处理该请求。只回复智能体的 id（如 "product-revenue"），不要回复其他内容。\n\n可用的智能体：\n${skillList}`,
        },
        { role: 'user', content: message },
      ],
      temperature: 0.1,
    }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })

    const chosenId = response.content?.trim().replace(/^["']|["']$/g, '') || ''
    const matched = skills.find((s) => s.id === chosenId)
    if (matched) {
      console.log(`[IntentRecognition] Matched skill: ${matched.name}`)
      return matched
    }
    const nameMatch = skills.find((s) => chosenId.includes(s.name) || s.name.includes(chosenId))
    if (nameMatch) {
      console.log(`[IntentRecognition] Name-matched skill: ${nameMatch.name}`)
      return nameMatch
    }
    return skills[0]
  } catch (err) {
    console.error('[IntentRecognition] Error:', err)
    return skills[0]
  }
}

export async function handleAgentMessage(
  ws: WebSocket,
  msg: AgentMessage,
  mcp: McpPool
): Promise<void> {
  const { sessionId, message, orders, autoAssign, taskId } = msg
  if (!sessionId || !message) return

  // Abort any previous LLM call for this session and serialize processing
  sessionAborts.get(sessionId)?.abort()
  const prevLock = sessionLocks.get(sessionId)
  if (prevLock) {
    try { await prevLock } catch { /* previous handler may have thrown */ }
  }

  const abortController = new AbortController()
  sessionAborts.set(sessionId, abortController)

  let releaseLock: () => void = () => {}
  const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve })
  sessionLocks.set(sessionId, lockPromise)

  const startTime = Date.now()
  let totalTokens = { prompt: 0, completion: 0 }

  try {

  if (taskId) {
    await generateTodosForTask(ws, sessionId, taskId, message, orders || [], mcp, abortController.signal)
    return
  }

  // Skill resolution
  let skill: Skill | null = null
  const allSkills = loadSkills()

  if (msg.skillId) {
    skill = allSkills.find((s) => s.id === msg.skillId) || null
  }

  if (!skill && autoAssign && allSkills.length > 0) {
    const modelId = msg.model || getDefaultModel()
    skill = await recognizeIntent(message, allSkills, modelId)

    if (skill && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'skill_assigned',
        sessionId,
        assignedSkillId: skill.id,
        assignedSkillName: skill.name,
      }))
    }
  }

  if (!skill) {
    ws.send(JSON.stringify({ type: 'error', content: `Skill not found: ${msg.skillId}`, sessionId }))
    return
  }

  const modelId = msg.model || getDefaultModel()
  const provider = getProviderForModel(modelId)
  if (!provider) {
    ws.send(JSON.stringify({ type: 'error', content: `Model not found: ${modelId}`, sessionId }))
    return
  }

  // Clear previous task list for this session when starting a new conversation
  todoStores.delete(sessionId)
  send(ws, { type: 'todo_list', sessionId, todos: [] })

  // Send initial status
  send(ws, { type: 'status', sessionId, status: 'thinking', skillName: skill.name, skillIcon: skill.icon, skillColor: skill.color, modelId })

  const systemPrompt = buildSystemPrompt(skill, orders)
  const session = getOrCreateSession(sessionId, skill.id, systemPrompt)
  const sessionKey = `${sessionId}:${skill.id}`

  // Inject order data
  let userMessage = message
  if (orders && orders.length > 0) {
    const orderData = await fetchOrderData(orders)
    if (orderData) {
      userMessage += `\n\n以下是与选中订单相关的业务数据（JSON 格式），请基于此数据进行履约分析：\n\`\`\`json\n${orderData}\n\`\`\``
    } else {
      userMessage += `\n\n[关联订单] ${orders.join(', ')}（注意：未能从系统获取到这些订单的详细数据）`
    }
  }

  // Run before_chat hooks
  const beforeChatCtx = { sessionId, skillId: skill.id, skillName: skill.name, message: userMessage }
  const beforeChatResults = await runHooks('before_chat', beforeChatCtx)
  for (const hr of beforeChatResults) {
    if (hr.modifiedContext?.message) {
      userMessage = hr.modifiedContext.message as string
    }
  }

  pushMessage(sessionKey, session, { role: 'user', content: userMessage })
  session.updatedAt = Date.now()

  // Determine whether to enable A2UI visualization and analysis task creation
  const enableA2ui = shouldEnableA2ui(message, skill)
  const enableAnalysisTask = shouldCreateAnalysisTask(message, skill, orders)

  const mcpTools = mcp.getTools().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }))
    // Always include built-in tools; show_analysis_result only when A2UI is enabled
    const tools = [
      TODO_WRITE_TOOL,
      SAVE_SKILL_TOOL,
      SAVE_HOOK_TOOL,
      SEND_NOTIFICATION_TOOL,
      LIST_NOTIFICATION_CHANNELS_TOOL,
      ...(enableA2ui ? [SHOW_ANALYSIS_RESULT_TOOL] : []),
      ...mcpTools,
    ]

    console.log(`[AgentLoop] Starting streaming for ${skill.name} via ${modelId}`)

    let iteration = 0
    let finalContent = ''

    while (iteration < MAX_ITERATIONS) {
      iteration++

      if (iteration > 1) {
        send(ws, { type: 'status', sessionId, status: 'calling_tool', skillName: skill.name, skillIcon: skill.icon, skillColor: skill.color, modelId })
      }

      // Stream LLM response
      let streamContent = ''
      const accumulatedToolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map()

      for await (const chunk of streamChat({
        model: modelId,
        messages: session.messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId || '' }
          }
          const base: any = { role: m.role, content: m.content }
          if (m.role === 'assistant' && m.toolCalls) {
            base.tool_calls = m.toolCalls
          }
          return base
        }),
        temperature: 0.7,
        tools: tools.length > 0 ? tools : undefined,
      }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl, signal: abortController.signal })) {

        // Forward content chunks to frontend in real-time
        if (chunk.content) {
          streamContent += chunk.content
          send(ws, { type: 'chunk', content: chunk.content, sessionId, taskId: getActiveTaskId(sessionId) })
        }

        // Track usage
        if (chunk.usage) {
          totalTokens.prompt += chunk.usage.promptTokens
          totalTokens.completion += chunk.usage.completionTokens
        }

        // Accumulate tool calls from streaming deltas
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            if (tc.id) {
              // New tool call
              const idx = accumulatedToolCalls.size
              accumulatedToolCalls.set(idx, {
                id: tc.id,
                type: tc.type || 'function',
                function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
              })
            } else if (tc.function?.arguments && accumulatedToolCalls.size > 0) {
              // Append arguments to the last tool call
              const lastKey = Array.from(accumulatedToolCalls.keys()).pop()!
              const last = accumulatedToolCalls.get(lastKey)!
              last.function.arguments += tc.function.arguments
            }
          }
        }
      }

      // Track tokens and check compaction after each LLM call
      await trackTokensAndCompact(sessionKey, session, totalTokens.prompt, modelId)

      // Process accumulated tool calls
      const toolCallsArr = Array.from(accumulatedToolCalls.values())
      if (toolCallsArr.length > 0) {
        pushMessage(sessionKey, session, {
          role: 'assistant',
          content: streamContent,
          toolCalls: toolCallsArr,
        })

        for (const toolCall of toolCallsArr) {
          const toolName = toolCall.function.name
          let toolArgs: Record<string, unknown> = {}
          try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch { /* keep empty */ }

          // Notify frontend of tool execution
          const toolLabel = getToolLabel(toolName, toolArgs)
          send(ws, {
            type: 'tool_call',
            sessionId,
            toolName,
            toolInput: toolArgs,
            toolLabel,
          })

          // Handle built-in todo_write tool
          if (toolName === 'todo_write') {
            const resultText = handleTodoWrite(toolArgs, sessionId, ws)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
            continue
          }

          // Handle built-in save_skill tool
          if (toolName === 'save_skill') {
            const resultText = handleSaveSkill(toolArgs)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
            continue
          }

          // Handle built-in save_hook tool
          if (toolName === 'save_hook') {
            const resultText = handleSaveHook(toolArgs)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
            continue
          }

          // Handle built-in show_analysis_result tool
          if (toolName === 'show_analysis_result') {
            const resultText = handleShowAnalysisResult(toolArgs, sessionId, ws)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
            continue
          }

          // Handle built-in send_notification tool
          if (toolName === 'send_notification') {
            const resultText = await handleSendNotification(toolArgs)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
            continue
          }

          // Handle built-in list_notification_channels tool
          if (toolName === 'list_notification_channels') {
            const resultText = await handleListNotificationChannels()
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
            continue
          }

          // Run before_tool_call hooks
          const beforeHookCtx = { sessionId, skillId: skill.id, skillName: skill.name, toolName, toolArgs }
          const beforeHookResults = await runHooks('before_tool_call', beforeHookCtx)
          for (const hr of beforeHookResults) {
            if (hr.modifiedContext?.toolArgs) {
              Object.assign(toolArgs, hr.modifiedContext.toolArgs)
            }
          }

          try {
            const handle = await mcp.acquire({ workDir: session.workDir })
            let result: unknown
            try {
              result = await handle.callTool(toolName, toolArgs)
            } finally {
              handle.release()
            }
            let resultText = typeof result === 'string' ? result : JSON.stringify(result)

            // Run after_tool_call hooks
            const afterHookCtx = { sessionId, skillId: skill.id, skillName: skill.name, toolName, toolArgs, toolResult: resultText }
            const afterHookResults = await runHooks('after_tool_call', afterHookCtx)
            for (const hr of afterHookResults) {
              if (hr.modifiedContext?.toolResult) {
                resultText = hr.modifiedContext.toolResult as string
              }
            }

            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: resultText.slice(0, 200),
            })
          } catch (err: any) {
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: `Error: ${err.message}`,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: `Error: ${err.message}`,
            })
          }
        }
        continue
      }

      // No tool calls — final response
      finalContent = streamContent || '抱歉，我未能生成有效的分析结果。'
      pushMessage(sessionKey, session, { role: 'assistant', content: finalContent })
      break
    }

    const elapsed = Date.now() - startTime

    // Extract structured JSON and create analysis task — only when enabled
    let analysisId: string | undefined
    let analysisTitle: string | undefined
    let redirect: string | undefined
    let hasStructuredResult = false

    if (enableAnalysisTask) {
      const structuredJson = extractStructuredJson(finalContent)
      if (structuredJson) {
        try {
          const parsed = JSON.parse(structuredJson)
          if (parsed.analysisTitle) {
            analysisTitle = parsed.analysisTitle
          }
        } catch { /* use fallback title logic */ }
      }

      // Fallback: detect title from old format marker
      if (!analysisTitle) {
        const analysisTitleMatch = finalContent.match(/\[创建分析任务[：:]\s*(.+?)\]/)
        if (analysisTitleMatch) {
          analysisTitle = analysisTitleMatch[1].trim()
        } else if (orders && orders.length > 0) {
          const hasAnalysisSections = /##\s*(分析|履约|风险|建议|结论|卡点|诊断|报告)/.test(finalContent)
          if (hasAnalysisSections) {
            analysisTitle = `${skill.name} — ${orders[0]}等${orders.length}个订单履约分析`
          }
        }
      }

      if (analysisTitle) {
        const task = await createAnalysisTask(analysisTitle, skill.name, orders || [])
        if (task) {
          analysisId = task.id
          redirect = `/analysis/${task.id}`

          // Save structured result to database
          if (structuredJson) {
            const saved = await saveStructuredResult(task.id, structuredJson)
            hasStructuredResult = saved
            if (saved) {
              console.log(`[AgentLoop] Structured result saved for task ${task.id}`)
            }
          }
        }
      }
    }

    // Look up context window for the used model
    const modelInfo = getAllModels().find((m) => m.id === modelId)
    const contextWindow = modelInfo?.contextWindow

    // Persist chat history (user + assistant messages only)
    const chatMsgs = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
    saveChatHistory(sessionId, chatMsgs)
    // Also save under the analysis task ID so the analysis page can load it
    if (analysisId && analysisId !== sessionId) {
      saveChatHistory(analysisId, chatMsgs)
    }

    // Run after_chat hooks
    const afterChatCtx = { sessionId, skillId: skill.id, skillName: skill.name, message: finalContent }
    const afterChatResults = await runHooks('after_chat', afterChatCtx)
    for (const hr of afterChatResults) {
      if (hr.modifiedContext?.message) {
        finalContent = hr.modifiedContext.message as string
      }
    }

    // Send complete with full stats
    send(ws, {
      type: 'complete',
      sessionId,
      analysisId,
      analysisTitle,
      redirect,
      hasStructuredResult,
      elapsed,
      totalTokens: totalTokens.prompt + totalTokens.completion,
      promptTokens: totalTokens.prompt,
      completionTokens: totalTokens.completion,
      contextWindow,
      skillName: skill.name,
      skillIcon: skill.icon,
      skillColor: skill.color,
      modelId,
      taskId: getActiveTaskId(sessionId),
    })

  } catch (err: any) {
    if (err.name === 'AbortError' || abortController.signal.aborted) {
      send(ws, { type: 'stopped', sessionId, elapsed: Date.now() - startTime })
      return
    }
    console.error('[AgentLoop] Error:', err)

    // Run on_error hooks
    const errorCtx = { sessionId, errorMessage: err.message || '未知错误' }
    await runHooks('on_error', errorCtx)

    send(ws, {
      type: 'error',
      content: `处理失败: ${err.message}`,
      errorMessage: err.message || '未知错误',
      sessionId,
      elapsed: Date.now() - startTime,
    })
  } finally {
    if (sessionAborts.get(sessionId) === abortController) {
      sessionAborts.delete(sessionId)
    }
    releaseLock()
  }
}

async function generateTodosForTask(
  ws: WebSocket,
  sessionId: string,
  taskId: string,
  userMessage: string,
  orders: string[],
  mcp: McpPool,
  signal?: AbortSignal,
): Promise<void> {
  const modelId = getDefaultModel()
  const provider = getProviderForModel(modelId)
  if (!provider) {
    send(ws, { type: 'error', content: `Model not found: ${modelId}`, sessionId })
    return
  }

  send(ws, { type: 'status', sessionId, status: 'thinking', skillName: '待办生成', modelId })

  const startTime = Date.now()

  // Fetch existing task data from backend
  let taskContext = ''
  try {
    const res = await fetch(`${BACKEND_API}/analysis/${taskId}/full`)
    if (res.ok) {
      const full = await res.json()
      taskContext = JSON.stringify(full, null, 2)
    }
  } catch { /* continue without context */ }

  const systemPrompt = `你是订单履约待办清单生成专家。根据已有的问题看板分析结果，为每个问题生成具体的待办执行任务。

## 任务生成规则
- 每个问题卡片至少生成 1 个待办任务
- 任务类型分为：agent（Agent自动执行）、decision（需人工决策）、manual（需手工操作）
- 优先级：high（逾期/紧急）、medium（正常）、low（可延后）
- 状态：pending（待处理）
- 任务分类：发货任务、入库任务、合同确认、异常处理

## 待办清单 JSON 格式
\`\`\`json
{
  "todos": [
    {
      "contractNumber": "订单系统编号（使用数据的 id 字段值，不是 contractNumber）",
      "category": "发货任务",
      "description": "具体任务描述",
      "priority": "high",
      "assignee": "建议负责人",
      "dueDate": "2024-11-18",
      "status": "pending",
      "taskType": "agent"
    }
  ]
}
\`\`\`

请基于以下分析结果生成待办清单：\n${taskContext}\n\n用户指令：${userMessage}`

  const session = getOrCreateSession(`${sessionId}:todos`, 'todo-generator', systemPrompt)
  const todoSessionKey = `${sessionId}:todos:todo-generator`

  if (orders.length > 0) {
    const orderData = await fetchOrderData(orders)
    if (orderData) {
      pushMessage(todoSessionKey, session, { role: 'user', content: `${userMessage}\n\n关联订单数据：\n\`\`\`json\n${orderData}\n\`\`\`` })
    } else {
      pushMessage(todoSessionKey, session, { role: 'user', content: userMessage })
    }
  } else {
    pushMessage(todoSessionKey, session, { role: 'user', content: userMessage })
  }

  try {
    const mcpTools = mcp.getTools().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }))
    const tools = [TODO_WRITE_TOOL, SAVE_SKILL_TOOL, SAVE_HOOK_TOOL, SEND_NOTIFICATION_TOOL, LIST_NOTIFICATION_CHANNELS_TOOL, ...mcpTools]

    let iteration = 0
    let finalContent = ''

    while (iteration < MAX_ITERATIONS) {
      iteration++

      let streamContent = ''
      const accumulatedToolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map()

      for await (const chunk of streamChat({
        model: modelId,
        messages: session.messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId || '' }
          }
          const base: any = { role: m.role, content: m.content }
          if (m.role === 'assistant' && m.toolCalls) {
            base.tool_calls = m.toolCalls
          }
          return base
        }),
        temperature: 0.7,
        tools: tools.length > 0 ? tools : undefined,
      }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl, signal })) {

        if (chunk.content) {
          streamContent += chunk.content
          send(ws, { type: 'chunk', content: chunk.content, sessionId, taskId: getActiveTaskId(sessionId) })
        }

        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            if (tc.id) {
              const idx = accumulatedToolCalls.size
              accumulatedToolCalls.set(idx, {
                id: tc.id,
                type: tc.type || 'function',
                function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
              })
            } else if (tc.function?.arguments && accumulatedToolCalls.size > 0) {
              const lastKey = Array.from(accumulatedToolCalls.keys()).pop()!
              const last = accumulatedToolCalls.get(lastKey)!
              last.function.arguments += tc.function.arguments
            }
          }
        }
      }

      const toolCallsArr = Array.from(accumulatedToolCalls.values())
      if (toolCallsArr.length > 0) {
        pushMessage(todoSessionKey, session, { role: 'assistant', content: streamContent, toolCalls: toolCallsArr })
        for (const toolCall of toolCallsArr) {
          let toolArgs: Record<string, unknown> = {}
          try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch { /* keep empty */ }
          const toolName = toolCall.function.name

          if (toolName === 'todo_write') {
            const resultText = handleTodoWrite(toolArgs, sessionId, ws)
            pushMessage(todoSessionKey, session, { role: 'tool', content: resultText, toolCallId: toolCall.id })
            continue
          }

          if (toolName === 'save_skill') {
            const resultText = handleSaveSkill(toolArgs)
            pushMessage(todoSessionKey, session, { role: 'tool', content: resultText, toolCallId: toolCall.id })
            continue
          }

          if (toolName === 'save_hook') {
            const resultText = handleSaveHook(toolArgs)
            pushMessage(todoSessionKey, session, { role: 'tool', content: resultText, toolCallId: toolCall.id })
            continue
          }

          if (toolName === 'send_notification') {
            const resultText = await handleSendNotification(toolArgs)
            pushMessage(todoSessionKey, session, { role: 'tool', content: resultText, toolCallId: toolCall.id })
            continue
          }

          if (toolName === 'list_notification_channels') {
            const resultText = await handleListNotificationChannels()
            pushMessage(todoSessionKey, session, { role: 'tool', content: resultText, toolCallId: toolCall.id })
            continue
          }

          try {
            const handle = await mcp.acquire({ workDir: session.workDir })
            let result: unknown
            try {
              result = await handle.callTool(toolName, toolArgs)
            } finally {
              handle.release()
            }
            pushMessage(todoSessionKey, session, { role: 'tool', content: typeof result === 'string' ? result : JSON.stringify(result), toolCallId: toolCall.id })
          } catch (err: any) {
            pushMessage(todoSessionKey, session, { role: 'tool', content: `Error: ${err.message}`, toolCallId: toolCall.id })
          }
        }
        continue
      }

      finalContent = streamContent || '已生成待办清单。'
      pushMessage(todoSessionKey, session, { role: 'assistant', content: finalContent })
      break
    }

    // Extract todos JSON and save
    const todosJson = extractStructuredJson(finalContent)
    if (todosJson) {
      try {
        const parsed = JSON.parse(todosJson)
        if (parsed.todos && Array.isArray(parsed.todos)) {
          // Save todos to backend
          await fetch(`${BACKEND_API}/analysis/${taskId}/todos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ todos: parsed.todos }),
          })
        }
      } catch { /* ignore parse errors */ }
    }

    // Update task status to todos_generated
    await fetch(`${BACKEND_API}/analysis/${taskId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todos_generated' }),
    })

    const elapsed = Date.now() - startTime
    send(ws, {
      type: 'complete',
      sessionId,
      analysisId: taskId,
      hasStructuredResult: true,
      taskId,
      elapsed,
      totalTokens: 0,
    })
  } catch (err: any) {
    if (signal?.aborted || err.name === 'AbortError') return
    console.error('[AgentLoop] Generate todos error:', err)
    send(ws, { type: 'error', content: `待办生成失败: ${err.message}`, sessionId })
  }
}

function getToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'bash': return `执行命令: ${String(args.command || '').slice(0, 60)}`
    case 'read_file': return `读取文件: ${String(args.file_path || '').slice(0, 60)}`
    case 'Skill': return `加载 Skill: ${String(args.skill || '')}`
    case 'todo_write': {
      const todos = args.todos as Array<{ status: string; content: string }> | undefined
      if (todos && Array.isArray(todos)) {
        const counts = { pending: 0, in_progress: 0, completed: 0 }
        for (const t of todos) {
          if (t.status === 'pending') counts.pending++
          if (t.status === 'in_progress') counts.in_progress++
          if (t.status === 'completed') counts.completed++
        }
        if (counts.completed > 0) return `更新任务: ${counts.completed}已完成 ${counts.in_progress}进行中 ${counts.pending}待处理`
        return `创建任务列表: ${todos.length}项`
      }
      return '更新待办清单'
    }
    case 'save_skill': return `保存 Skill: ${String(args.name || args.skillId || '')}`
    case 'save_hook': return `保存 Hook: ${String(args.name || args.hookId || '')}`
    case 'show_analysis_result': return `生成分析页面: ${String(args.title || '')}`
    case 'send_notification': return `发送通知: ${String(args.channelId || '')}`
    case 'list_notification_channels': return `获取通知渠道列表`
    default: return `调用 ${name}`
  }
}

export async function handleAgentHttpRequest(skillId: string, prompt: string): Promise<{ content: string; skillName: string }> {
  const skill = loadSkills().find((s) => s.id === skillId)
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`)
  }

  const modelId = getDefaultModel()
  const provider = getProviderForModel(modelId)
  if (!provider) {
    throw new Error(`Model not found: ${modelId}`)
  }

  const systemPrompt = buildSystemPrompt(skill, undefined)
  const response = await chatCompletion({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })

  return { content: response.content || '', skillName: skill.name }
}

function send(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function buildSystemPrompt(skill: Skill, orders?: string[]): string {
  let prompt = `你是「${skill.name}」。\n\n${skill.prompt}\n\n`
  prompt += `当前时间: ${new Date().toLocaleString('zh-CN')}\n`
  prompt += `你可以使用以下工具来完成任务:\n`
  prompt += `- Skill: 加载其他 skill 定义\n`
  prompt += `- read_file: 读取文件内容\n`
  prompt += `- todo_write: 创建和管理任务列表\n`
  prompt += `- save_skill: 将新创建的 Skill 保存到文件系统（skillId、name、description、icon、color、prompt 六个必填参数，可选的 references 数组和 scripts 数组用于创建参考文档和脚本文件）\n`
  prompt += `- save_hook: 将新创建的 Hook 保存到文件系统（hookId、name、description、event、script 五个必填参数，enabled 和 matcher 可选）\n`
  prompt += `- show_analysis_result: 【严格限制】仅在用户明确要求"生成图表"、"可视化展示"、"看板"、"仪表盘"、"生成分析页面"等时才调用。普通文字分析、数据查询、状态检查等常规任务禁止调用此工具。参数：title（面板标题）、a2uiMessages（A2UI 消息数组）\n\n`

  // Add references and scripts info
  if (skill.references.length > 0 || skill.scripts.length > 0) {
    prompt += `## 可用参考资源\n`
    if (skill.references.length > 0) {
      prompt += `### 参考文档（使用 read_file 工具按需读取）\n`
      for (const ref of skill.references) {
        prompt += `- ${ref.name}: read_file("skills/${skill.id}/${ref.id}")\n`
      }
    }
    if (skill.scripts.length > 0) {
      prompt += `### 脚本（使用 Bash 工具执行）\n`
      for (const sc of skill.scripts) {
        prompt += `- ${sc.name}: skills/${skill.id}/${sc.id}\n`
      }
    }
    prompt += `\n`
  }


  // A2UI component reference
  prompt += `## A2UI 组件参考\n`
  prompt += `show_analysis_result 的 a2uiMessages 是由以下三种消息组成的数组，依次发送：\n`
  prompt += `1. createSurface: { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json" } }\n`
  prompt += `2. updateComponents: { version: "v0.9", updateComponents: { surfaceId: "main", components: [...] } }\n`
  prompt += `3. updateDataModel: { version: "v0.9", updateDataModel: { surfaceId: "main", value: {...} } }\n\n`
  prompt += `可用组件及属性（每个组件必须有 component 和 id）:\n`
  prompt += `- Text: { component: "Text", text: "内容"|{"path":"/key"}, variant?: "h1"|"h2"|"h3"|"h4"|"h5"|"caption"|"body" }\n`
  prompt += `- Row: { component: "Row", children: ["id1","id2"], justify?: "spaceBetween"|"center"|"start"|"end", align?: "center"|"start"|"end"|"stretch", gap?: 8 }\n`
  prompt += `- Column: { component: "Column", children: [...], align?: "center"|"start"|"end"|"stretch", gap?: 8 }\n`
  prompt += `- Card: { component: "Card", child: "childId" }\n`
  prompt += `- Icon: { component: "Icon", name: "star"|"warning"|"check"|"info"|"error"|"trending_up"|"arrow_upward"|... }\n`
  prompt += `- Button: { component: "Button", text: "按钮文字", variant?: "primary"|"danger" }\n`
  prompt += `- Divider: { component: "Divider" }\n`
  prompt += `- Tag: { component: "Tag", text: "标签", color?: "#hex" }\n`
  prompt += `- ProgressBar: { component: "ProgressBar", value: 65, max?: 100, text?: "标签" }\n`
  prompt += `- Table: { component: "Table", columns: [{key:"k","label":"列名"}], rows: [{"k":"v"}] 或 rows: {"path":"/data"} }\n`
  prompt += `数据绑定：属性值可以是字面量或 {"path":"/dataKey"} 来引用 dataModel 中的数据。\n\n`

  // Task execution protocol
  prompt += `## 任务执行规范\n`
  prompt += `当你的任务涉及多个分析步骤时，你**必须**遵循以下流程：\n\n`
  prompt += `1. **规划阶段**：先调用 todo_write 工具，列出所有待执行的步骤（每个步骤一个 todo 项，status 设为 "pending"）\n`
  prompt += `2. **执行阶段**：逐项处理任务：\n`
  prompt += `   - 开始处理某项时，调用 todo_write 将该任务状态更新为 "in_progress"\n`
  prompt += `   - 一次只处理一个 "in_progress" 任务\n`
  prompt += `   - 完成后立即调用 todo_write 将状态改为 "completed"\n`
  prompt += `3. **完成阶段**：确保所有任务都标记为 "completed" 后再输出最终结果\n\n`
  prompt += `示例：如果分析订单履约需要 4 个步骤（查询订单数据、分析库存状态、排查采购延迟、生成看板报告），你应该：\n`
  prompt += `- 第一步：todo_write 创建 4 个 pending 任务\n`
  prompt += `- 第二步：todo_write 将任务1标记为 in_progress → 执行任务1 → todo_write 标记为 completed\n`
  prompt += `- 依次处理所有任务\n\n`

  if (orders && orders.length > 0) {
    prompt += `\n用户已选中订单: ${orders.join(', ')}。你将收到这些订单的业务数据。\n`
    prompt += `重要：订单数据中的 "id" 字段是订单在系统中的唯一编号（如 HT202598001），请在分析中始终使用 "id" 字段值来指代订单。"contractNumber" 是合同号，不要将其作为订单编号使用。\n`
  }

  prompt += `\n请用中文回复。`

  prompt += `\n\n## 结构化输出要求`

  prompt += `\n分析完成后，你必须在回复末尾输出一个 JSON 代码块，包含按「订单→问题分类→具体问题」层级组织的分析结果。格式如下：`

  prompt += `\n\n\`\`\`json
{
  "analysisTitle": "分析任务标题",
  "orders": [
    {
      "contractNumber": "订单系统编号（使用数据中的 id 字段值，如 HT202598001，不是 contractNumber 字段）",
      "customer": "客户名称",
      "amount": "合同金额（万元）",
      "shipmentRatio": 65,
      "status": "待发货",
      "statusClass": "blue",
      "sales": "销售员",
      "region": "区域",
      "orderDate": "2024/11/14",
      "problemCategories": [
        {
          "name": "问题分类名称（如：未接发货、入库登记、发货方式存在问题、未知问题）",
          "type": 1,
          "problems": [
            {
              "materialCode": "物料编码",
              "materialName": "物料名称",
              "partName": "部件名称",
              "partNumber": "部件编号",
              "tags": [{"label": "待处理", "variant": "pill"}, {"label": "紧急", "variant": "urgent"}],
              "cardDetail": {
                "materialInfo": {
                  "需求属性": "控制系统",
                  "需求类别": "产品型",
                  "品牌": "CCU-2000",
                  "需求系列描述": "断路器控制板",
                  "需求定制产品": "定制",
                  "发货方式": "直发客户"
                },
                "aiAnalysis": "该物料当前存在发货延迟风险，主要原因是...",
                "deliveryPath": [
                  {"docType": "销售合同订单", "docNo": "SO_20240001", "badge": "BPM", "qty": 100, "status": "生效", "problemPoint": "合同约定数量与实际发货存在偏差"},
                  {"docType": "发货申请单", "docNo": "SA_20240001", "badge": "BPM", "qty": 100, "status": "审核中", "problemPoint": "审核流程卡在财务环节"},
                  {"docType": "销售出库单", "docNo": "DN_20240001", "badge": "SAP", "qty": 80, "status": "已过账", "problemPoint": "实发数量80，短少20"}
                ]
              }
            }
          ]
        }
      ],
      "todos": [
        {
          "category": "发货任务",
          "description": "任务描述",
          "priority": "high",
          "assignee": "负责人",
          "dueDate": "2024-11-18",
          "status": "pending",
          "taskType": "agent"
        }
      ],
      "deliveryTables": [
        {
          "title": "销售合同订单",
          "badge": "BPM",
          "items": [
            {"docNo": "SO_20240001", "status": "生效", "lineNo": "10", "sign": "蓝字", "qty": 100}
          ]
        }
      ]
    }
  ]
}
\`\`\``

  prompt += `\n\n注意事项：`
  prompt += `\n- statusClass 取值：blue（待发货）、green（进行中）、orange（待确认）`
  prompt += `\n- type 取值：1=问题类型1, 2=问题类型2, 3=问题类型3, 4=问题类型4`
  prompt += `\n- variant 取值：pill（普通标签）、urgent（紧急）、normal（常规）`
  prompt += `\n- priority 取值：high（高）、medium（中）、low（低）`
  prompt += `\n- status（待办）取值：pending（待处理）、progress（进行中）、overdue（已逾期）`
  prompt += `\n- taskType 取值：agent（Agent任务）、decision（决策任务）、manual（手工任务）`
  prompt += `\n- 必须以 \`\`\`json 开头、\`\`\` 结尾，确保 JSON 可被程序解析`
  prompt += `\n- 在 JSON 之前先输出自然语言的分析总结`

  return prompt
}

async function saveStructuredResult(analysisId: string, jsonStr: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(jsonStr)
    const res = await fetch(`${BACKEND_API}/analysis/${analysisId}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    })
    return res.ok
  } catch (err) {
    console.error('[AgentLoop] Failed to save structured result:', err)
    return false
  }
}

function extractStructuredJson(content: string): string | null {
  const match = content.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return null
}
