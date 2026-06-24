import { WebSocket } from 'ws'
import fs from 'fs'
import path from 'path'
import type { Session, Skill, Hook, AgentMessage, TodoItem } from '../types'
import { streamChat, chatCompletion } from './llmEngine'
import type { McpPool } from './mcpPool'
import { SessionStore } from './sessionStore'
import { getProviderForModel, getDefaultModel, getAllModels } from './llmConfig'
import { loadSkills, createSkill, saveSkill, saveSkillFile } from './skillLoader'
import { loadHooks, createHook, saveHook } from './hookLoader'
import { runHooks } from './hookRunner'
import { getEnabledTools } from './toolManager'

const sessions = new Map<string, Session>()
const todoStores = new Map<string, TodoItem[]>()
const sessionLocks = new Map<string, Promise<void>>()
const sessionAborts = new Map<string, AbortController>()
const pendingBoundaries = new Map<string, Array<{ taskId: string; taskContent: string; verified?: boolean }>>()

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

// Helper: track tokens (for cost analytics) and trigger compaction based on
// the LATEST API call's input size — not a cumulative sum that double-counts
// earlier messages that are re-sent in every subsequent call.
//
// Compaction uses a "cache-safe fork" — it sends the conversation's own system
// prompt and history as the prefix, appending only the summarization instruction
// as a new user message.  This way the API prefix-matcher sees byte-identical
// content up to the summarization instruction and serves the entire prefix from
// cache (~90% cost reduction on the compaction call).
async function trackTokensAndCompact(
  key: string, session: Session, promptTokens: number, modelId: string,
  ws?: WebSocket, sessionId?: string
): Promise<void> {
  if (!sessionStore) return

  // Accumulate for cost/analytics only (not used for compaction decisions anymore)
  sessionStore.addInputTokens(key, promptTokens)
  session.cumulativeInputTokens += promptTokens

  // Two-tier threshold: warn at 70%, compact at 80% of context window
  const { getAllModels } = await import('./llmConfig.js')
  const modelInfo = getAllModels().find((m) => m.id === modelId)
  const contextWindow = modelInfo?.contextWindow || 128000
  const warnThreshold = Math.floor(contextWindow * 0.70)
  const compactThreshold = Math.floor(contextWindow * 0.80)

  // Send warning to frontend at 70% (before compaction is needed)
  if (promptTokens >= warnThreshold && promptTokens < compactThreshold && ws && sessionId) {
    send(ws, { type: 'context_warning', sessionId, promptTokens, contextWindow } as any)
  }

  if (promptTokens >= compactThreshold) {
    try {
      const { getProviderForModel } = await import('./llmConfig.js')
      const provider = getProviderForModel(modelId)
      // Cache-safe fork: use the conversation's *own* system prompt and full
      // message history as the prefix, append only the summarization request.
      // The API caches the identical prefix and only processes the new user
      // message — matching Claude Code's compaction architecture.
      const result = await sessionStore.compactSession(key, provider ? async (messages, prevSummary) => {
        const { chatCompletion } = await import('./llmEngine.js')
        const prevCtx = prevSummary ? `\n\nPrevious summary for continuity:\n${prevSummary}` : ''
        const resp = await chatCompletion({
          model: modelId,
          messages: [
            ...messages,  // [system prompt, user, assistant, tool, ...] — cached prefix
            {
              role: 'user',
              content: `You are summarizing the conversation above. All tasks described are completed.\n\n${SUMMARIZATION_PROMPT}${prevCtx}`,
            },
          ],
          temperature: 0.3,
        }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })
        return resp.content || ''
      } : undefined)
      console.log(`[AgentLoop] Session ${key} compacted: removed ${result.removedCount} messages (prompt was ${promptTokens}/${contextWindow})`)
      // Refresh session messages from store
      const updated = sessionStore.getSession(key)
      if (updated) session.messages = updated.messages

      // Post-compaction: inject context breadcrumb so the agent knows what happened
      if (result.removedCount > 0) {
        const breadcrumb = `[Compaction: ${result.removedCount} earlier messages were summarized above. Current date: ${new Date().toISOString().slice(0, 10)}. The summary preserves key decisions, file changes, errors, and pending tasks.]`
        if (updated) {
          updated.messages.push({ role: 'system', content: breadcrumb })
        }
        session.messages.push({ role: 'system', content: breadcrumb })
      }
    } catch (err) {
      console.error('[AgentLoop] Compaction failed:', err)
      // Don't leave the counter in a broken state — reset it so the next
      // iteration doesn't start from an inflated value.
      session.cumulativeInputTokens = 0
      if (sessionStore) {
        try { sessionStore.resetInputTokens(key) } catch { /* best-effort */ }
      }
    }
  }
}

const SUMMARIZATION_PROMPT = `You are summarizing a conversation between an AI agent and a user. All tasks described below are already completed. Your summary must preserve enough context that the conversation can resume seamlessly — a developer reading it cold should understand what happened, what was decided, and what comes next.

Format your summary as:

1. Primary Request and Intent:
   - What the user originally asked for and why.

2. Key Technical Concepts:
   - Technologies, APIs, frameworks, patterns, or domain concepts discussed.

3. Files and Code Sections:
   - List each file read or modified, with a one-line description of what happened to it.
   - Include approximate line ranges when known.

4. Errors and fixes:
   - Every error encountered, its root cause, and how it was resolved.

5. Problem Solving:
   - Problems solved and ongoing troubleshooting.

6. All user messages:
   - List every user message in chronological order (each under 160 chars).

7. Pending Tasks:
   - Items explicitly marked as TODO or not yet started.

8. Current Work:
   - What was being done immediately before this summary.

9. Optional Next Step:
   - One concrete action the AI could take next to move the conversation forward.

Keep the summary under 2000 characters and 40 lines. Each line under 200 characters.`

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
const MAX_ITERATIONS_PLAN_MODE = 20
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
    description: 'Send a notification message through a configured notification channel (email, WeCom bot, Feishu bot, DingTalk bot, or DingTalk enterprise app). Use this to notify users about important events like analysis completion, overdue tasks, or status changes.',
    parameters: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The ID of the notification channel to use. Call list_notification_channels first to see available channels.' },
        to: { type: 'string', description: 'Recipient address. For email: comma-separated email addresses. For WeCom/Feishu/DingTalk bots: can be empty (webhook determines the destination). For DingTalk enterprise app: comma-separated user IDs (e.g. user1,user2).' },
        subject: { type: 'string', description: 'Message subject (used for email and DingTalk enterprise app, ignored for other bots)' },
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
    description: 'List all configured notification channels (email, WeCom bot, Feishu bot, DingTalk bot, DingTalk enterprise app). Use this to discover available channels before sending a notification.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

const FETCH_BIZ_DATA_TOOL = {
  type: 'function' as const,
  function: {
    name: 'fetch_biz_data',
    description: '获取业务合同/装置/包/物料的层级数据及齐套分析结果。支持按合同ID或包ID查询。返回合同信息、物料列表、齐套汇总以及每个物料的每日供需平衡数据。',
    parameters: {
      type: 'object',
      properties: {
        contractId: { type: 'string', description: '合同ID，如 SC-2025-001' },
        packageId: { type: 'string', description: '包ID，如 PKG-0101-SC-2025-001' },
      },
      required: [],
    },
  },
}

async function handleFetchBizData(args: Record<string, unknown>): Promise<string> {
  const contractId = args.contractId as string | undefined
  const packageId = args.packageId as string | undefined

  if (!contractId && !packageId) {
    return 'Error: Either contractId or packageId is required'
  }

  try {
    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    let url: string
    if (packageId) {
      url = `${BACKEND_API}/biz-contracts/packages/${encodeURIComponent(packageId)}/kit-check`
    } else {
      url = `${BACKEND_API}/biz-contracts/${encodeURIComponent(contractId!)}/kit-check`
    }
    const response = await fetch(url)
    if (!response.ok) {
      return `Error fetching biz data: HTTP ${response.status}`
    }
    const data = await response.json()
    return JSON.stringify(data, null, 2)
  } catch (err: any) {
    return `Error fetching biz data: ${err.message}`
  }
}

const FETCH_ORDERS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'fetch_orders',
    description: '获取销售订单列表，支持按品牌、销售员、签收状态、发货状态、异常标记、客户等筛选。返回订单数组，每条订单包含 id/contractNumber/customer/brand/salesperson/orderDate/deliveryDays/shipMethod/skuCount/amount/receiptRatio/shipmentRatio/isException 等字段。适用于生成履约看板仪表盘。',
    parameters: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: '品牌主体' },
        salesperson: { type: 'string', description: '销售员姓名' },
        shipMethod: { type: 'string', description: '发货方式' },
        receiptStatus: { type: 'string', description: '签收状态' },
        deliveryStatus: { type: 'string', description: '出库状态' },
        isException: { type: 'boolean', description: '是否异常订单' },
        customer: { type: 'string', description: '客户主体名称' },
        pageSize: { type: 'number', description: '每页数量，默认100' },
      },
      required: [],
    },
  },
}

const MARK_TASK_COMPLETE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'mark_task_complete',
    description: '验证并标记执行任务为已完成。先检查关联订单数据确认任务是否真正完成，然后将任务标记为done并通过飞书机器人通知相关人员，附带分析任务深度链接供点击进入分析。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '执行任务ID（analysis_todos表的id）' },
        assigneeNote: { type: 'string', description: '待办人填写的完成备注说明' },
      },
      required: ['taskId'],
    },
  },
}

async function handleMarkTaskComplete(args: Record<string, unknown>, ws: WebSocket, sessionId: string): Promise<string> {
  const taskId = String(args.taskId || '')
  const assigneeNote = String(args.assigneeNote || '')

  if (!taskId) {
    return 'Error: taskId is required'
  }

  try {
    // Step 1: GET task data without marking complete
    const getRes = await fetch(`${BACKEND_API}/execution-tasks/${encodeURIComponent(taskId)}`)
    if (!getRes.ok) {
      return `Error: Failed to fetch task — ${getRes.statusText}`
    }
    const taskData = await getRes.json() as any
    const analysisTaskId = taskData.source_analysis_task_id || ''

    // Step 2: Extract material codes from task description and fetch LIVE stock data
    const taskDescription = taskData.description || taskData.title || ''
    const taskContractId = taskData.contract_number || ''
    const materialCodeRegex = /\b([A-Z]{2,4}-\d{3,4}[A-Za-z]?|[A-Z]{2}\d{6}|[A-Z]+-\d{2,4}-[A-Za-z]?)\b/g
    const materialCodes = [...new Set(
      (taskDescription.match(materialCodeRegex) || [])
        .filter((c: string) => !/^\d{4}-\d{2}-\d{2}$/.test(c)) // exclude dates
    )]

    let liveMaterialContext = ''
    const liveShortages: Array<{ materialCode: string; contractNo: string; shortageQty: number; currentStock: number; requiredQty: number }> = []
    for (const code of materialCodes) {
      try {
        const matRes = await fetch(`${BACKEND_API}/biz-contracts/materials/search?code=${encodeURIComponent(code)}`)
        if (matRes.ok) {
          const matData = await matRes.json()
          if (matData.contracts?.length > 0) {
            // Filter to only this task's contract to avoid LLM confusion from other contracts
            let contracts = matData.contracts
            if (taskContractId) {
              contracts = contracts.filter((c: any) => c.contractNo === taskContractId)
            }
            if (contracts.length === 0) continue
            const summary = contracts.map((c: any) => ({
              materialCode: matData.materialCode,
              contractNo: c.contractNo,
              currentStock: c.currentStock,
              requiredQty: c.requiredQty,
              shortageQty: c.shortageQty,
              inTransit: c.inTransit,
              kitStatus: c.kitStatus,
              supplier: c.supplier,
            }))
            liveMaterialContext += `\n[实时库存] ${JSON.stringify(summary)}`
            for (const s of summary) {
              if (s.shortageQty > 0) {
                liveShortages.push(s)
              }
            }
          }
        }
      } catch { /* material search optional */ }
    }

    // Programmatic safety net: if the task's contract-related materials still have shortage > 0, auto-reject
    if (liveShortages.length > 0) {
      const shortageDetails = liveShortages
        .map(s => `${s.materialCode}: 缺口${s.shortageQty}个 (库存${s.currentStock}/需求${s.requiredQty})`)
        .join(', ')
      // Send verification_result to frontend via WebSocket
      send(ws, {
        type: 'verification_result',
        sessionId,
        taskId,
        verified: false,
        verificationNote: `未完成。合同${taskContractId}的实时库存数据显示物料仍有缺口: ${shortageDetails}`,
      })
      return JSON.stringify({
        taskId,
        analysisTaskId,
        status: taskData.status || 'pending',
        verified: false,
        verificationNote: `未完成。合同${taskContractId}的实时库存数据显示物料仍有缺口: ${shortageDetails}`,
        message: `任务验证未通过，已拦截标记完成操作。实时库存数据显示物料仍有缺口。`,
      }, null, 2)
    }

    // Step 3: Fetch analysis context (filter to relevant cards only)
    let analysisContext = ''
    const contractNumbers: string[] = []
    if (analysisTaskId) {
      try {
        const analysisRes = await fetch(`${BACKEND_API}/analysis/${encodeURIComponent(analysisTaskId)}/full`)
        if (analysisRes.ok) {
          const analysisData = await analysisRes.json()
          if (analysisData.orders) {
            for (const order of analysisData.orders) {
              if (order.contract_number) contractNumbers.push(order.contract_number)
            }
          }
          // Extract only cards matching the task's material codes to keep context focused
          const relevantCards: any[] = []
          if (analysisData.orders) {
            for (const order of analysisData.orders) {
              for (const cat of order.problemCategories || []) {
                for (const card of cat.cards || []) {
                  if (materialCodes.length === 0 || materialCodes.includes(card.material_code)) {
                    relevantCards.push({
                      material_code: card.material_code,
                      material_name: card.material_name,
                      status: card.status,
                      cardDetail: card.cardDetail?.materialInfo,
                    })
                  }
                }
              }
            }
          }
          if (relevantCards.length > 0) {
            analysisContext = JSON.stringify(relevantCards)
          }
        }
      } catch { /* analysis context optional */ }
    }

    // Step 4: LLM verification
    const modelId = (await import('./llmConfig.js')).getDefaultModel()
    const provider = (await import('./llmConfig.js')).getProviderForModel(modelId)

    let verificationNote = ''
    let verificationPassed = true

    if (provider) {
      try {
        const verifyResp = await chatCompletion({
          model: modelId,
          messages: [
            {
              role: 'system',
              content: `你是订单履约控制塔的任务完成验证助手。你的职责是严格验证一个任务是否真的应该被标记为完成。

关键原则：任务描述的是一个需要人去执行的问题（缺口、滞后、逾期等）。"存在理论解决方案"不等于任务完成。必须确认问题在数据库中已经被实际解决。

判定规则（必须严格遵守）：
1. [实时库存]数据是数据库当前最新状态，[分析快照]是问题发现时的记录。以[实时库存]为准判断当前状态。
2. 仅当[实时库存]数据显示问题已被实际解决（如 currentStock >= requiredQty 即缺口已消除、shortageQty=0），才可判定"已完成"。
3. 如果[实时库存]中找不到对应物料，请查看[分析快照]。如果两者都没有该物料数据，回复"未完成"并说明无法确认。
4. "其他合同有库存可调拨"不是完成 — 调拨尚未执行。"供应商可以加急"不是完成 — 加急尚未下单。
5. 如果无法从数据中确认问题已实际解决，必须回复"未完成"并说明哪些条件未满足。

你的回复必须以"已完成"或"未完成"开头。绝大多数情况下应该回复"未完成"。`,
            },
            {
              role: 'user',
              content: `任务信息：
- 任务ID: ${taskId}
- 任务描述: ${taskDescription}
- 负责人: ${taskData.assignee || ''}
- 待办人备注: ${assigneeNote || '无'}

${liveMaterialContext ? `实时库存数据（数据库当前最新状态，以这份数据为准）:\n${liveMaterialContext}` : '（未找到相关物料实时数据）'}
${analysisContext ? `\n分析快照数据（问题发现时记录，仅供参考）:\n${analysisContext}` : ''}

请判断该任务是否真的可以标记为完成。请以"已完成"或"未完成"开头给出结论。`,
            },
          ],
          temperature: 0.3,
        }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })
        verificationNote = verifyResp.content || ''

        // Strict verification: must start with "已完成" and NOT contain hedging
        const startsWithDone = /^已完成/.test(verificationNote.trim())
        const hedgingIndicators = ['可通过', '可以通', '但需', '但需要', '建议', '还需', '仍需', '尚需', '待', '未完成', '不通过', '未达标', '尚未完成', '不能标记', '不可标记', '不建议']
        const hasHedging = hedgingIndicators.some(ind => verificationNote.includes(ind))
        verificationPassed = startsWithDone && !hasHedging
      } catch {
        verificationNote = '自动验证完成（LLM验证跳过）'
      }
    } else {
      verificationNote = '自动验证完成（未配置LLM）'
    }

    // Step 5: If verification FAILS, block the operation
    if (!verificationPassed) {
      // Send verification_result to frontend via WebSocket
      send(ws, {
        type: 'verification_result',
        sessionId,
        taskId,
        verified: false,
        verificationNote,
      })
      return JSON.stringify({
        taskId,
        analysisTaskId,
        status: taskData.status || 'pending',
        verified: false,
        verificationNote,
        message: `任务验证未通过，已拦截标记完成操作。验证结论: ${verificationNote}`,
      }, null, 2)
    }

    // Step 6: Verification PASSED — mark task as done via PUT /api/execution-tasks/:id
    const markRes = await fetch(`${BACKEND_API}/execution-tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', completedAt: new Date().toLocaleString('zh-CN'), assigneeNote }),
    })

    if (!markRes.ok) {
      const errData = await markRes.json().catch(() => ({}))
      return `Error: Failed to mark task complete — ${(errData as any).error || markRes.statusText}`
    }

    const taskInfo = await markRes.json() as any
    if (!taskInfo.success) {
      return `Error: ${taskInfo.error || 'Unknown error'}`
    }

    // Step 6.5: Create follow-up execution steps if the verification note indicates remaining work
    let newStepsCreated = 0
    let cardsUpdated = 0
    const followUpActions = extractFollowUpSteps(verificationNote, taskData)

    if (followUpActions.length > 0 && analysisTaskId) {
      // Find the corresponding execution task by source_analysis_task_id
      try {
        const execTasksRes = await fetch(`${BACKEND_API}/execution-tasks?page=1&pageSize=100`)
        if (execTasksRes.ok) {
          const execTasksData = await execTasksRes.json()
          const matchingExecTask = (execTasksData.data || []).find(
            (et: any) => et.source_analysis_task_id === analysisTaskId
          )
          const execTaskId = matchingExecTask?.id

          if (execTaskId) {
            // Get current step count for ordering
            const existingStepsRes = await fetch(`${BACKEND_API}/execution-tasks/${encodeURIComponent(execTaskId)}/steps`)
            let stepOrder = 1
            if (existingStepsRes.ok) {
              const stepsData = await existingStepsRes.json()
              stepOrder = (stepsData.data || []).length + 1
            }

            // Create follow-up steps
            for (const action of followUpActions) {
              try {
                const createRes = await fetch(`${BACKEND_API}/execution-tasks/${encodeURIComponent(execTaskId)}/steps`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    stepOrder: stepOrder++,
                    stepType: action.stepType,
                    title: action.title,
                    description: action.description,
                    status: 'pending',
                    assignee: taskData.assignee || '',
                  }),
                })
                if (createRes.ok) newStepsCreated++
              } catch { /* skip failed steps */ }
            }
          }
        }
      } catch { /* follow-up step creation optional */ }

      // Update problem card statuses for cards related to this task's materials
      if (materialCodes.length > 0) {
        try {
          const analysisFullRes = await fetch(`${BACKEND_API}/analysis/${encodeURIComponent(analysisTaskId)}/full`)
          if (analysisFullRes.ok) {
            const analysisData = await analysisFullRes.json()
            for (const order of analysisData.orders || []) {
              for (const cat of order.problemCategories || []) {
                for (const card of cat.cards || []) {
                  if (materialCodes.includes(card.material_code)) {
                    try {
                      const updateRes = await fetch(
                        `${BACKEND_API}/analysis/problems/${encodeURIComponent(card.id || card.problemId)}/status`,
                        {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: '已解决' }),
                        }
                      )
                      if (updateRes.ok) cardsUpdated++
                    } catch { /* skip failed card updates */ }
                  }
                }
              }
            }
          }
        } catch { /* card status update optional */ }
      }
    }

    // Step 7: Send verification_result to frontend via WebSocket
    send(ws, {
      type: 'verification_result',
      sessionId,
      taskId,
      verified: true,
      verificationNote,
    })

    // Step 8: Fetch remaining tasks for the same analysis, then send Feishu notification
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
    const allContractNums = taskInfo.contractNumbers || contractNumbers

    // Query remaining pending todos for this analysis task
    let remainingTasks: any[] = []
    if (analysisTaskId) {
      try {
        const tasksRes = await fetch(`${BACKEND_API}/tasks?page=1&pageSize=200`)
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json()
          // Filter to non-done tasks sharing any contract with the completed task
          const relatedContracts = new Set(allContractNums)
          remainingTasks = (tasksData.data || []).filter(
            (t: any) => t.id !== taskId && t.status !== 'done' && (t.contractId && relatedContracts.has(t.contractId))
          )
        }
      } catch { /* optional */ }
    }

    const assignee = taskData.assignee || '待办人'
    const taskTitle = taskData.title || taskData.description || ''
    const chatPrompt = `任务「${taskTitle}」已标记完成，请分析当前合同${(allContractNums || []).join('、')}的剩余待办情况，结合分析数据生成下一步待办任务建议`
    const deepLink = analysisTaskId
      ? `${FRONTEND_URL}/analysis/${encodeURIComponent(analysisTaskId)}?chat=1&prompt=${encodeURIComponent(chatPrompt)}`
      : FRONTEND_URL

    const notificationLines: string[] = []
    notificationLines.push(`✅ ${assignee}已完成任务：${taskTitle}`)
    notificationLines.push('')
    notificationLines.push(`关联合同：${(allContractNums || []).join(', ')}`)
    notificationLines.push(`任务编号：${taskId}`)

    if (newStepsCreated > 0) {
      notificationLines.push('')
      notificationLines.push(`🆕 已自动创建 ${newStepsCreated} 个后续执行步骤`)
    }
    if (cardsUpdated > 0) {
      notificationLines.push(`📋 已更新 ${cardsUpdated} 个问题卡片状态为"已解决"`)
    }

    if (remainingTasks.length > 0) {
      const pendingCount = remainingTasks.filter((t: any) => t.status === 'pending').length
      const progressCount = remainingTasks.filter((t: any) => t.status === 'progress').length
      const overdueCount = remainingTasks.filter((t: any) => t.status === 'overdue').length

      notificationLines.push('')
      notificationLines.push(`📋 当前仍有 ${remainingTasks.length} 个关联任务待完成：`)
      if (overdueCount > 0) notificationLines.push(`  · 逾期：${overdueCount} 个`)
      if (progressCount > 0) notificationLines.push(`  · 进行中：${progressCount} 个`)
      if (pendingCount > 0) notificationLines.push(`  · 待开始：${pendingCount} 个`)

      // List top 5 remaining tasks
      const urgentTasks = remainingTasks
        .sort((a: any, b: any) => {
          const prioOrder: Record<string, number> = { high: 0, mid: 1, low: 2 }
          return (prioOrder[a.priority] ?? 1) - (prioOrder[b.priority] ?? 1)
        })
        .slice(0, 5)
      notificationLines.push('')
      notificationLines.push('⏳ 优先处理：')
      for (const t of urgentTasks) {
        const pLabel = t.priority === 'high' ? '🔴' : t.priority === 'mid' ? '🟡' : '🟢'
        notificationLines.push(`  ${pLabel} ${t.title || t.description || ''}（${t.assignee || '未分配'}）`)
      }
    } else {
      notificationLines.push('')
      notificationLines.push('📋 该分析任务下所有待办已全部完成。')
    }

    notificationLines.push('')
    notificationLines.push(`👉 请登录系统查看详情并进行下一步确认：`)
    notificationLines.push(`${deepLink}`)

    const notificationMessage = notificationLines.join('\n')

    try {
      await fetch(`${BACKEND_API}/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'feishu-bot',
          message: notificationMessage,
        }),
      })
    } catch (err: any) {
      console.error('[AgentLoop] Feishu notification failed:', err.message)
    }

    // Step 9: Send todo_suggestion for next-step follow-ups
    const suggestedTodos = extractSuggestedTodos(verificationNote, taskData, allContractNums)
    if (suggestedTodos.length > 0) {
      send(ws, {
        type: 'todo_suggestion',
        sessionId,
        suggestedTodos,
        analysisId: analysisTaskId || undefined,
      })
    }

    // Step 10: Return success result
    return JSON.stringify({
      taskId,
      analysisTaskId,
      status: 'done',
      verified: true,
      verificationNote,
      newStepsCreated,
      cardsUpdated,
      deepLink,
      message: `任务已标记完成。验证结论: ${verificationNote}。${newStepsCreated > 0 ? `已创建 ${newStepsCreated} 个后续步骤。` : ''}${cardsUpdated > 0 ? `已更新 ${cardsUpdated} 个问题卡片。` : ''}飞书通知已发送，深度链接: ${deepLink}`,
    }, null, 2)
  } catch (err: any) {
    return `Error in mark_task_complete: ${err.message}`
  }
}

function extractSuggestedTodos(verificationNote: string, taskData: any, contractNumbers: string[]): Array<{ category: string; description: string; priority: string; assignee?: string; dueDate?: string; taskType?: string; contractNumber?: string }> {
  const todos: Array<{ category: string; description: string; priority: string; assignee?: string; dueDate?: string; taskType?: string; contractNumber?: string }> = []

  // If LLM mentioned follow-up actions, create todo suggestions
  const followUpPatterns = [
    { keyword: '采购', category: '入库任务', taskType: 'manual' },
    { keyword: '调拨', category: '入库任务', taskType: 'manual' },
    { keyword: '联系', category: '异常处理', taskType: 'manual' },
    { keyword: '确认', category: '合同确认', taskType: 'decision' },
    { keyword: '生产', category: '异常处理', taskType: 'manual' },
    { keyword: '发货', category: '发货任务', taskType: 'manual' },
    { keyword: '催货', category: '入库任务', taskType: 'manual' },
    { keyword: '签收', category: '发货任务', taskType: 'manual' },
  ]

  for (const pattern of followUpPatterns) {
    if (verificationNote.includes(pattern.keyword)) {
      todos.push({
        category: pattern.category,
        description: `[跟进] ${taskData.description || taskData.title || ''} — ${verificationNote.slice(0, 80)}`,
        priority: 'high',
        assignee: taskData.assignee || '',
        taskType: pattern.taskType,
        contractNumber: contractNumbers[0] || '',
      })
      break // Only one suggestion
    }
  }

  return todos
}

// Extract follow-up execution steps from the verification note.
// When the LLM determines the task is "已完成" but mentions subsequent actions,
// create new execution steps for the same assignee so work continues automatically.
interface FollowUpStep {
  stepType: string  // 'manual' | 'decision' | 'agent'
  title: string
  description: string
}

function extractFollowUpSteps(verificationNote: string, taskData: any): FollowUpStep[] {
  const steps: FollowUpStep[] = []
  const taskTitle = taskData.title || taskData.description || ''

  // Keyword → step mapping
  const stepPatterns: Array<{ keywords: string[]; stepType: string; actionName: string }> = [
    { keywords: ['采购', '加急', '补货', '下单'], stepType: 'manual', actionName: '采购/补货' },
    { keywords: ['调拨', '调配', '转库'], stepType: 'manual', actionName: '库存调拨' },
    { keywords: ['催货', '催交', '跟催'], stepType: 'manual', actionName: '催货跟进' },
    { keywords: ['发货', '出库', '发运'], stepType: 'manual', actionName: '发货执行' },
    { keywords: ['验收', '签收', '收货', '入库'], stepType: 'manual', actionName: '验收/签收' },
    { keywords: ['确认', '审批', '核准'], stepType: 'decision', actionName: '确认/审批' },
    { keywords: ['联系', '沟通', '协调'], stepType: 'manual', actionName: '沟通协调' },
    { keywords: ['生产', '排产', '加工'], stepType: 'manual', actionName: '生产追踪' },
  ]

  for (const pattern of stepPatterns) {
    if (pattern.keywords.some(kw => verificationNote.includes(kw))) {
      // Only create ONE follow-up step to avoid flooding
      const descPrefix = verificationNote.slice(0, 100).replace(/已完成[，。]?/, '')
      steps.push({
        stepType: pattern.stepType,
        title: `[跟进] ${pattern.actionName} — ${taskTitle.slice(0, 30)}`,
        description: `根据校验结论：${descPrefix}。请执行${pattern.actionName}相关操作。`,
      })
      break
    }
  }

  // If no specific keyword matched but verification note suggests follow-up (e.g., "但需关注")
  if (steps.length === 0 && (verificationNote.includes('关注') || verificationNote.includes('监控'))) {
    steps.push({
      stepType: 'manual',
      title: `[跟进] 持续关注 — ${taskTitle.slice(0, 30)}`,
      description: `校验通过但建议持续关注：${verificationNote.slice(0, 100)}`,
    })
  }

  return steps
}

async function handleFetchOrders(args: Record<string, unknown>): Promise<string> {
  try {
    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    const params = new URLSearchParams()
    const paramKeys = ['brand', 'salesperson', 'shipMethod', 'receiptStatus', 'deliveryStatus', 'customer'] as const
    for (const key of paramKeys) {
      if (args[key]) params.set(key, String(args[key]))
    }
    if (args.isException !== undefined && args.isException !== null) {
      params.set('isException', String(args.isException))
    }
    const pageSize = Number(args.pageSize) || 100
    params.set('pageSize', String(pageSize))
    params.set('page', '1')

    const response = await fetch(`${BACKEND_API}/orders?${params.toString()}`)
    if (!response.ok) {
      return `Error fetching orders: HTTP ${response.status}`
    }
    const result = await response.json()
    const orders = result.data || []
    return JSON.stringify(orders, null, 2)
  } catch (err: any) {
    return `Error fetching orders: ${err.message}`
  }
}

const SEARCH_MATERIAL_STOCK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_material_stock',
    description: '按物料编码搜索所有合同中的库存分布情况，用于判断可调拨来源。返回每个合同的可用库存、在途量、优先级、富余量(surplus=库存+在途-需求)等信息。',
    parameters: {
      type: 'object',
      properties: {
        materialCode: { type: 'string', description: '物料编码，如 DLQ-001' },
      },
      required: ['materialCode'],
    },
  },
}

async function handleSearchMaterialStock(args: Record<string, unknown>): Promise<string> {
  const materialCode = args.materialCode as string
  if (!materialCode) return 'Error: materialCode is required'
  try {
    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    const response = await fetch(`${BACKEND_API}/biz-contracts/materials/search?code=${encodeURIComponent(materialCode)}`)
    if (!response.ok) return `Error: HTTP ${response.status}`
    const data = await response.json()
    return JSON.stringify(data, null, 2)
  } catch (err: any) {
    return `Error: ${err.message}`
  }
}

const GET_PENDING_TODOS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_pending_todos',
    description: '获取所有未完成的待办任务清单。包括分析任务生成的待办和执行任务中的未完结待办。按负责人分组返回，包含任务ID、类别、描述、优先级、截止日期、状态等信息。',
    parameters: {
      type: 'object',
      properties: {
        assignee: { type: 'string', description: '可选，按负责人筛选。不传则返回全部。' },
      },
      required: [],
    },
  },
}

async function handleGetPendingTodos(args: Record<string, unknown>): Promise<string> {
  try {
    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
    const assignee = args.assignee as string | undefined

    // Fetch analysis tasks and execution tasks in parallel
    const [analysisRes, tasksRes] = await Promise.all([
      fetch(`${BACKEND_API}/analysis?pageSize=100`),
      fetch(`${BACKEND_API}/tasks?pageSize=200`),
    ])

    const analyses = (await analysisRes.json() as any).data || []
    const execTasks = (await tasksRes.json() as any).data || []

    const allTodos: any[] = []

    // Fetch todos from analysis tasks
    for (const a of analyses) {
      if (a.status === 'todos_generated') {
        try {
          const todoRes = await fetch(`${BACKEND_API}/analysis/${encodeURIComponent(a.id)}/todos`)
          const todoData = await todoRes.json() as any
          if (todoData.data) {
            for (const t of todoData.data) {
              t._source = 'analysis'
              t._analysisTitle = a.title
              t._analysisId = a.id
              t._url = `${FRONTEND_URL}/analysis/${a.id}`
              allTodos.push(t)
            }
          }
        } catch { /* skip */ }
      }
    }

    // Add execution tasks (status != done)
    for (const t of execTasks) {
      if (t.status !== 'done') {
        const taskType = t.type || 'manual'
        const execUrl = `${FRONTEND_URL}/task/${taskType}/${t.id}`
        allTodos.push({
          id: t.id,
          category: t.categoryLabel || '未知',
          description: t.title || '',
          priority: t.priority || 'medium',
          assignee: t.assignee || '未分配',
          dueDate: t.dueDate || '',
          status: t.statusLabel || '未知',
          _source: 'task',
          _analysisTitle: '',
          _analysisId: '',
          _url: execUrl,
        })
      }
    }

    // Filter by assignee if specified
    const filtered = assignee
      ? allTodos.filter((t: any) => t.assignee === assignee)
      : allTodos

    // Group by assignee
    const grouped: Record<string, any[]> = {}
    for (const t of filtered) {
      const name = t.assignee || '未分配'
      if (!grouped[name]) grouped[name] = []
      grouped[name].push(t)
    }

    // Build summary
    const result: any = {
      total: filtered.length,
      assigneeCount: Object.keys(grouped).length,
      byPriority: {
        high: filtered.filter((t: any) => t.priority === 'high').length,
        medium: filtered.filter((t: any) => t.priority === 'medium').length,
        low: filtered.filter((t: any) => t.priority === 'low').length,
      },
      overdue: filtered.filter((t: any) => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length,
      byAssignee: {} as Record<string, any>,
    }

    for (const [name, todos] of Object.entries(grouped)) {
      result.byAssignee[name] = {
        count: todos.length,
        high: todos.filter((t: any) => t.priority === 'high').length,
        overdue: todos.filter((t: any) => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10)).length,
        todos: todos.map((t: any) => ({
          id: t.id,
          category: t.category,
          description: (t.description || '').slice(0, 60),
          priority: t.priority,
          dueDate: t.dueDate,
          status: t.status,
          url: t._url || `${FRONTEND_URL}/tasks`,
        })),
      }
    }

    return JSON.stringify(result, null, 2)
  } catch (err: any) {
    return `Error fetching pending todos: ${err.message}`
  }
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
        taskId: {
          type: 'string',
          description: '可选。如果当前对话上下文已有分析任务ID，可传入以便持久化A2UI数据。如无现成的任务ID则留空。',
        },
      },
      required: ['title', 'a2uiMessages'],
    },
  },
}

// Convert LLM's generic format to proper A2UI v0.9 wire format.
// LLMs use many different conventions — this normalizer handles:
//   - { type: "createSurface", surfaceId: "x" } → { createSurface: { surfaceId, catalogId } }
//   - components as array OR object map → flattened array
//   - nested children OR parent-based hierarchy → ID-list references
//   - content/text, items/children, icon/name, spacing/gap, weight/fontWeight aliases
//   - nested style objects → flattened to top-level props
//   - box/hbox/vbox/hstack/vstack/grid/flex/badge/stat → A2UI component names
function normalizeA2uiMessages(raw: unknown[]): unknown[] {
  const CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'

  const COMPONENT_MAP: Record<string, string> = {
    flex: 'Column', vstack: 'Column', vbox: 'Column', box: 'Column',
    hstack: 'Row', hbox: 'Row',
    text: 'Text', card: 'Card', button: 'Button', table: 'Table',
    chart: 'Chart', divider: 'Divider', tag: 'Tag', badge: 'Tag',
    stat: 'Card', icon: 'Icon', image: 'Image',
    progressbar: 'ProgressBar', progress: 'ProgressBar',
    list: 'Column', grid: 'Row',
    // LLM hallucination fallbacks — normalize common model-invented types
    header: 'Text', heading: 'Text', title: 'Text',
    row: 'Row', section: 'Column', container: 'Column',
    panel: 'Card', cell: 'Text', label: 'Text',
    spacer: 'Divider', separator: 'Divider',
  }

  const SUPPORTED_TYPES = new Set([
    'Text', 'Row', 'Column', 'Card', 'Table', 'Chart',
    'Tag', 'ProgressBar', 'Divider', 'Button', 'Icon', 'Image',
    'List', 'CheckBox', 'TextField', 'Slider',
  ])

  // Props that should stay as-is (not treated as style)
  const KNOWN_PROPS = new Set([
    'id', 'component', 'text', 'content', 'url', 'name', 'icon', 'variant',
    'child', 'children', 'items', 'action', 'gap', 'spacing', 'padding',
    'align', 'justify', 'width', 'height', 'value', 'max', 'columns', 'rows',
    'xKey', 'yKeys', 'colors', 'labels', 'chartType', 'fit', 'description',
    'fontWeight', 'weight', 'size', 'color', 'type', 'parent', 'surface', 'surfaceId',
    'style', 'props', 'data', 'path', 'backgroundColor', 'borderRadius',
    'boxShadow', 'borderLeft', 'border', 'marginTop', 'marginBottom',
    'marginRight', 'marginLeft', 'margin', 'flex', 'minWidth', 'minHeight',
    'maxWidth', 'maxHeight', 'display', 'position', 'overflow', 'alignItems',
    'justifyContent', 'flexWrap', 'flexDirection', 'fontSize', 'lineHeight',
    'textAlign', 'textDecoration', 'opacity', 'background',
  ])

  // Flatten a nested style object (and any other unknown objects) into top-level props
  function flattenStyle(converted: Record<string, unknown>, src: Record<string, unknown>) {
    if (src.style && typeof src.style === 'object') {
      for (const [k, v] of Object.entries(src.style as Record<string, unknown>)) {
        if (!(k in converted)) converted[k] = v
      }
      delete src.style
    }
    // Copy remaining unknown props to top-level
    for (const k of Object.keys(src)) {
      if (KNOWN_PROPS.has(k)) continue
      if (k.startsWith('_') || typeof src[k] === 'function') continue
      if (!(k in converted)) converted[k] = src[k]
    }
  }

  // Convert a single LLM-style node to A2UI component shape (flat, no nested children).
  function flattenNode(node: any, out: any[]): any {
    if (!node || typeof node !== 'object') return node

    const converted: Record<string, unknown> = {}
    const src = { ...node }

    // Ensure id exists
    if (!src.id) src.id = `auto_${Math.random().toString(36).slice(2, 8)}`

    // Map component type
    if (typeof src.type === 'string') {
      const lower = src.type.toLowerCase()
      converted.component = COMPONENT_MAP[lower] || src.type
      delete src.type
    }
    // Fallback: unsupported component types → Text
    if (converted.component && typeof converted.component === 'string' && !SUPPORTED_TYPES.has(converted.component)) {
      if (converted.text === undefined && (converted as any).content !== undefined) {
        converted.text = (converted as any).content
      }
      converted.component = 'Text'
    }

    // Copy known A2UI props directly (preserving original values)
    for (const k of Object.keys(src)) {
      if (!KNOWN_PROPS.has(k)) continue
      if (k === 'id' || k === 'component') continue // already handled
      if (converted[k] !== undefined) continue
    }

    // id and component already set
    if (src.id) converted.id = src.id

    // Map content → text
    if ('content' in src) { converted.text = src.content; delete src.content }
    else if ('text' in src) { converted.text = src.text; delete src.text }

    // Map icon → name for Icon component
    if ('icon' in src) { converted.name = src.icon; delete src.icon }

    // Map weight → fontWeight
    if ('weight' in src) { converted.fontWeight = src.weight; delete src.weight }

    // Map spacing → gap
    if ('spacing' in src) { converted.gap = src.spacing; delete src.spacing }

    // Map align → alignment
    if ('align' in src) { converted.align = src.align; delete src.align }

    // Map size: if string → variant, if number → keep as fontSize
    if ('size' in src) {
      if (typeof src.size === 'string') {
        const sizeMap: Record<string, string> = { xs: 'caption', sm: 'body', md: 'body', lg: 'h3', xl: 'h2', '2xl': 'h2', '3xl': 'h1', '4xl': 'h1' }
        converted.variant = sizeMap[String(src.size)] || 'body'
      } else {
        converted.fontSize = src.size // numeric size
      }
      delete src.size
    }

    // Map color: string aliases → hex
    if ('color' in src) {
      const cmap: Record<string, string> = { green: '#10b981', red: '#ef4444', orange: '#f59e0b', blue: '#3b82f6', yellow: '#eab308', purple: '#8b5cf6', gray: '#6b7280', grey: '#6b7280', muted: '#9ca3af', white: '#ffffff', black: '#000000' }
      converted.color = cmap[String(src.color)] || src.color
      delete src.color
    }

    // Copy direct known props
    for (const k of ['url', 'name', 'variant', 'child', 'action', 'gap', 'padding', 'align', 'justify', 'width', 'height', 'value', 'max', 'columns', 'xKey', 'yKeys', 'colors', 'labels', 'chartType', 'fit', 'description', 'fontWeight']) {
      if (k in src) { converted[k] = src[k]; delete src[k] }
    }

    // Resolve DynamicValue {path: "..."} for rows, value, data
    for (const k of ['rows', 'value', 'data']) {
      if (src[k] && typeof src[k] === 'object' && 'path' in (src[k] as Record<string, unknown>)) {
        converted[k] = (src[k] as Record<string, unknown>).path
        delete src[k]
      }
      if (k in src) { converted[k] = src[k]; delete src[k] }
    }

    // Flatten props object
    if (src.props && typeof src.props === 'object') {
      for (const [k, v] of Object.entries(src.props as Record<string, unknown>)) {
        if (!(k in converted)) converted[k] = v
      }
      delete src.props
    }

    // Process children OR items (array-style nesting)
    const childSource = src.children || src.items
    if (Array.isArray(childSource)) {
      const childIds: string[] = []
      for (const child of childSource) {
        // String children are id references to already-flattened nodes
        if (typeof child === 'string') {
          childIds.push(child)
          continue
        }
        const flatChild = flattenNode(child, out)
        if (flatChild?.id) childIds.push(String(flatChild.id))
      }
      if (converted.component === 'Card' && childIds.length === 1) {
        converted.child = childIds[0]
      } else if (childIds.length > 0) {
        converted.children = childIds
      }
      delete src.children
      delete src.items
    }

    // Flatten style object + remaining unknown props
    flattenStyle(converted, src)

    out.push(converted)
    return converted
  }

  const result = raw.map((msg: any) => {
    if (!msg || typeof msg !== 'object') return msg

    // Already in A2UI wire format — return as-is
    if (msg.createSurface || msg.updateComponents || msg.updateDataModel || msg.deleteSurface) {
      return msg
    }

    const msgType = String(msg.type || '').toLowerCase()

    if (msgType === 'createsurface' || msgType === 'create_surface') {
      return {
        version: 'v0.9',
        createSurface: {
          surfaceId: msg.surfaceId || msg.surface || 'main',
          catalogId: CATALOG_ID,
        },
      }
    }

    if (msgType === 'updatecomponents' || msgType === 'update_components') {
      const flatComponents: any[] = []

      let compList: any[] = []
      if (Array.isArray(msg.components)) {
        compList = msg.components
      } else if (msg.components && typeof msg.components === 'object') {
        // LLM passed components as a map { id: node } → convert to array
        compList = Object.entries(msg.components as Record<string, any>).map(([key, val]) => {
          if (val && typeof val === 'object' && !val.id) val.id = key
          return val
        })
      }

      for (const comp of compList) {
        flattenNode(comp, flatComponents)
      }

      // Rebuild hierarchy from parent references (LLMs often use "parent" instead of nesting)
      const childrenMap = new Map<string, string[]>()
      for (const comp of flatComponents) {
        if (comp.parent && typeof comp.parent === 'string') {
          const list = childrenMap.get(comp.parent) || []
          list.push(comp.id as string)
          childrenMap.set(comp.parent, list)
        }
      }
      if (childrenMap.size > 0) {
        for (const comp of flatComponents) {
          const kids = childrenMap.get(comp.id as string)
          if (kids && kids.length > 0) {
            if (comp.component === 'Card' && kids.length === 1) {
              comp.child = kids[0]
            } else {
              comp.children = kids
            }
          }
          delete comp.parent // clean up
        }
      }

      // Post-process: fix common LLM output patterns for components
      postProcessComponents(flatComponents)

      return {
        version: 'v0.9',
        updateComponents: {
          surfaceId: msg.surfaceId || msg.surface || 'main',
          components: flatComponents,
        },
      }
    }

    if (msgType === 'updatedatamodel' || msgType === 'update_data_model' || msgType === 'updatedata') {
      return {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: msg.surfaceId || msg.surface || 'main',
          path: msg.path,
          value: msg.value ?? msg.data ?? {},
        },
      }
    }

    return msg
  })

  // Fix surfaceId consistency: force all messages to use the primary surfaceId from createSurface
  const primarySurfaceId = result.reduce<string | null>((acc, m: any) => {
    if (m?.createSurface?.surfaceId) return m.createSurface.surfaceId
    return acc
  }, null)

  if (primarySurfaceId) {
    for (const m of result) {
      if ((m as any)?.updateComponents?.surfaceId) {
        (m as any).updateComponents.surfaceId = primarySurfaceId
      }
      if ((m as any)?.updateDataModel?.surfaceId) {
        (m as any).updateDataModel.surfaceId = primarySurfaceId
      }
    }
  }

  // If updateComponents exists but has no root, auto-create one
  const ucMsg = result.find((m: any) => m?.updateComponents)
  if (ucMsg) {
    const comps: any[] = (ucMsg as any).updateComponents.components
    const hasRoot = comps.some((c: any) => c.id === 'root')
    if (!hasRoot) {
      const topLevelIds = comps
        .filter((c: any) => !comps.some((other: any) => {
          const kids = other.children as string[] | undefined
          return kids?.includes(c.id)
        }))
        .map((c: any) => c.id)
        .filter(Boolean)

      if (topLevelIds.length > 0) {
        comps.push({
          id: 'root',
          component: 'Column',
          children: topLevelIds,
          gap: 16,
        })
      }
    }
  }

  return result
}

// Post-process components to fix common LLM output patterns
function postProcessComponents(comps: any[]) {
  const compMap = new Map<string, any>()
  for (const c of comps) compMap.set(c.id, c)

  // Pass 1: fix template syntax {{var}} → data binding, and value→text for Text
  for (const comp of comps) {
    for (const key of ['text', 'value', 'title', 'label', 'content']) {
      const val = comp[key]
      if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
        const varName = val.slice(2, -2)
        comp[key] = { path: `/${varName}` }
      }
    }
    // For Text components: ensure text prop exists (map from value/title/content)
    if (comp.component === 'Text' || comp.component === 'text') {
      if (comp.text === undefined && comp.value !== undefined) {
        comp.text = comp.value
        delete comp.value
      } else if (comp.text === undefined && comp.content !== undefined) {
        comp.text = comp.content
        delete comp.content
      }
      if (comp.text === undefined && comp.title !== undefined) {
        comp.text = comp.title
        delete comp.title
      }
      // Clean up non-Text props that LLMs sometimes add
      delete comp.title
      delete comp.icon
      delete comp.name
    }
  }

  // Pass 2: detect stat-card pattern (Text with path-bound value + title) → Card > Column
  const newComps: any[] = []
  const replaceMap = new Map<string, string>()
  for (const comp of comps) {
    const hasValueBinding = comp.value && typeof comp.value === 'object' && 'path' in comp.value
    const hasTextBinding = comp.text && typeof comp.text === 'object' && 'path' in comp.text
    const hasDynamicText = hasValueBinding || hasTextBinding
    const hasStaticLabel = (comp.title && typeof comp.title === 'string') || (comp.label && typeof comp.label === 'string')

    if (comp.component === 'Text' && hasDynamicText && hasStaticLabel) {
      const cardId = comp.id
      const valueColId = `${cardId}-col`
      const labelId = `${cardId}-label`
      const valueId = `${cardId}-value`

      const labelText = comp.title || comp.label || ''
      const valueBinding = comp.value || comp.text
      const compColor = comp.color || undefined
      const compSize = comp.size || '3xl'

      compMap.set(labelId, { id: labelId, component: 'Text', text: String(labelText), variant: 'caption' })
      compMap.set(valueId, {
        id: valueId, component: 'Text', text: valueBinding,
        variant: typeof compSize === 'string' ? compSize : 'h3',
        color: compColor,
      })
      compMap.set(valueColId, { id: valueColId, component: 'Column', children: [labelId, valueId], gap: 4 })

      const cardComp = { id: cardId, component: 'Card', child: valueColId }
      replaceMap.set(cardId, cardId)
      newComps.push(cardComp)
      newComps.push(compMap.get(valueColId)!)
      newComps.push(compMap.get(labelId)!)
      newComps.push(compMap.get(valueId)!)
    } else {
      newComps.push(comp)
    }
  }

  const finalComps: any[] = []
  const seenIds = new Set<string>()
  for (const c of newComps) {
    if (!seenIds.has(c.id)) { seenIds.add(c.id); finalComps.push(c) }
  }
  for (const [id, comp] of compMap) {
    if (!seenIds.has(id)) { seenIds.add(id); finalComps.push(comp) }
  }
  for (const comp of finalComps) {
    if (Array.isArray(comp.children)) {
      comp.children = comp.children.map((cid: string) => replaceMap.get(cid) || cid)
    }
    if (comp.child && replaceMap.has(comp.child)) {
      comp.child = replaceMap.get(comp.child)
    }
  }

  comps.length = 0
  comps.push(...finalComps)

  // Pass 3: detect chart-like components → convert to Chart
  for (const comp of comps) {
    if (comp.component !== 'Text') continue
    const hasChartFields = comp.xField || comp.angleField || comp.yField ||
      (comp.title && comp.data !== undefined)
    if (!hasChartFields) continue

    comp.component = 'Chart'
    comp.chartType = comp.chartType || 'bar'
    if (comp.xField && !comp.xKey) { comp.xKey = comp.xField; delete comp.xField }
    if (comp.yField && !comp.yKeys) { comp.yKeys = [comp.yField]; delete comp.yField }
    if (comp.angleField) {
      comp.chartType = 'bar'
      if (!comp.xKey) comp.xKey = comp.colorField || 'name'
      if (!comp.yKeys) comp.yKeys = [comp.angleField]
      delete comp.angleField
      delete comp.colorField
    }
    if (comp.data !== undefined) { comp.rows = comp.data; delete comp.data }
    delete comp.title
    delete comp.height
    delete comp.columns
  }
}

function handleShowAnalysisResult(args: Record<string, unknown>, sessionId: string, ws: WebSocket): string {
  const title = String(args.title || 'AI分析结果')
  const a2uiMessages = args.a2uiMessages
  const taskId = args.taskId ? String(args.taskId) : undefined

  if (!Array.isArray(a2uiMessages) || a2uiMessages.length === 0) {
    return 'Error: a2uiMessages is required and must be a non-empty array'
  }

  const normalized = normalizeA2uiMessages(a2uiMessages)

  send(ws, {
    type: 'a2ui_surface',
    sessionId,
    title,
    messages: normalized,
    taskId,
  })

  // Persist A2UI data to backend if taskId is provided
  if (taskId) {
    fetch(`${BACKEND_API}/analysis/${taskId}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a2uiMessages: normalized }),
    }).catch(err => console.error('[AgentLoop] Failed to save A2UI data:', err))
  }

  return `A2UI可视化分析结果"${title}"已生成并展示在界面中。`
}

const CREATE_ANALYSIS_TASK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'create_analysis_task',
    description: '创建分析任务记录，将分析结果持久化保存到数据库。调用后会生成任务ID并跳转到分析任务页面，用户可在「看板分析」tab中查看结构化数据。A2UI可视化图表请直接调用 show_analysis_result。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '分析任务标题，如"HT202598001等2个订单履约分析"' },
        result: { type: 'object', description: '分析结果JSON，必须包含 orders 数组。每个order需包含：contractNumber(订单编号)、customer(客户)、amount(金额万元)、shipmentRatio(发货率数字)、status(状态)、statusClass(blue/green/orange)、sales(销售员)、region(区域)、orderDate(下单日期)、problemCategories(问题分类数组)、deliveryTables(交付表格数组)。详见系统提示中的JSON格式。' },
      },
      required: ['title', 'result'],
    },
  },
}

async function handleCreateAnalysisTask(
  args: Record<string, unknown>,
  ws: WebSocket,
  sessionId: string,
  skillName: string,
  skillId: string,
  orders: string[],
  currentPage?: string,
  sessionMessages?: Array<{ role: string; content: string }>,
  contextTaskId?: string,
): Promise<{ text: string; taskId?: string }> {
  // Hard-code guard: only allow analysis task creation from the homepage
  if (currentPage && currentPage !== 'home') {
    return {
      text: `当前页面为${currentPage === 'analysis' ? '分析任务详情页' : currentPage === 'task' ? '执行任务详情页' : '其他页面'}，根据系统规则，仅首页支持创建新的分析任务。请返回首页后再提交分析任务创建请求。此操作已被系统拦截。`,
    }
  }
  const title = String(args.title || `${skillName} — 履约分析`)
  const result = args.result as Record<string, unknown> | undefined
  const a2uiMessages = args.a2uiMessages

  // Update mode: user is already on an analysis page, update existing task
  if (contextTaskId) {
    let structuredJson: string | null = null
    if (sessionMessages) {
      const allAssistantContent = sessionMessages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n')
      structuredJson = extractStructuredJson(allAssistantContent)
    }

    const rawJson = structuredJson || (result ? JSON.stringify(result) : null)
    if (rawJson) {
      const filteredJson = await filterNewOrders(contextTaskId, rawJson)
      await saveStructuredResult(contextTaskId, filteredJson)
    }

    if (a2uiMessages && Array.isArray(a2uiMessages) && a2uiMessages.length > 0) {
      const normalized = normalizeA2uiMessages(a2uiMessages)
      fetch(`${BACKEND_API}/analysis/${contextTaskId}/result`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a2uiMessages: normalized }),
      }).catch(err => console.error('[AgentLoop] Failed to save A2UI data:', err))
    }

    send(ws, {
      type: 'analysis_updated',
      sessionId,
      analysisId: contextTaskId,
      analysisTitle: title,
    })

    return {
      text: `分析结果已更新到当前任务（ID: ${contextTaskId}）。`,
      taskId: contextTaskId,
    }
  }

  // Create mode: no existing task context, create a new one
  // Guard: require order data — either from UI selection or in the result parameter
  const hasResultOrders = result && hasOrdersInResult(result)
  if (orders.length === 0 && !hasResultOrders) {
    return {
      text: '创建分析任务需要具体的订单数据。请先在界面上选择要分析的订单（勾选订单后点击"加入对话"），或在消息中明确提供订单号/合同号。当前未检测到任何订单信息，分析任务创建已被拦截。',
    }
  }

  const task = await createAnalysisTask(title, skillName, skillId, orders)
  if (!task) {
    return { text: 'Error: 创建分析任务失败，请稍后重试' }
  }

  // Build base order data from API — guarantees orders are always saved
  let baseResult = orders.length > 0 ? await buildFallbackFromApi(orders) : null

  // Try to extract structured JSON from assistant messages for enrichment (problemCategories, etc.)
  let structuredJson: string | null = null
  if (sessionMessages) {
    const allAssistantContent = sessionMessages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n')
    structuredJson = extractStructuredJson(allAssistantContent)
  }

  // Prefer result parameter with orders, then structured JSON from messages, then API base
  let jsonToSave: string | null = null

  if (hasResultOrders) {
    // LLM passed a valid orders object — use it directly
    jsonToSave = JSON.stringify(result)
  } else if (structuredJson) {
    // Enrich base order data with LLM-provided problem categories
    try {
      const parsed = JSON.parse(structuredJson)
      if (parsed.orders && Array.isArray(parsed.orders)) {
        jsonToSave = structuredJson
      } else if (baseResult) {
        // Merge LLM analysis (categories, todos, etc.) into base orders
        jsonToSave = JSON.stringify({ ...baseResult, ...parsed })
      }
    } catch {
      // Can't parse structured JSON, fall through to base
    }
  }

  // Use base result from API as final fallback
  if (!jsonToSave && baseResult) {
    jsonToSave = JSON.stringify(baseResult)
  }

  if (jsonToSave) {
    const saved = await saveStructuredResult(task.id, jsonToSave)
    if (!saved) {
      console.error('[AgentLoop] Failed to save structured result for', task.id)
    }
  } else {
    console.warn('[AgentLoop] No structured JSON found for analysis task', task.id)
  }

  // Save A2UI messages if provided
  if (a2uiMessages && Array.isArray(a2uiMessages) && a2uiMessages.length > 0) {
    const normalized = normalizeA2uiMessages(a2uiMessages)
    fetch(`${BACKEND_API}/analysis/${task.id}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a2uiMessages: normalized }),
    }).catch(err => console.error('[AgentLoop] Failed to save A2UI data:', err))
  }

  send(ws, {
    type: 'analysis_created',
    sessionId,
    analysisId: task.id,
    analysisTitle: title,
    redirect: `/analysis/${task.id}`,
  })

  return {
    text: `分析任务已创建（ID: ${task.id}），用户可在历史分析页面查看。如果用户需要生成待办清单，请等待用户在界面点击「生成待办清单」按钮（会发送特定格式消息），收到该消息后再调用 generate_todos。`,
    taskId: task.id,
  }
}

const UPDATE_ANALYSIS_TASK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'update_analysis_task',
    description: '更新已有分析任务的结构化数据。当用户在分析任务详情页（currentPage === "analysis"）与agent对话，发现分析结果中有识别错误或需要修正的问题时，调用此工具更新分析任务的 orders/problemCategories/deliveryTables 等数据。此工具不会创建新任务，只会覆盖现有任务的 result 字段。',
    parameters: {
      type: 'object',
      properties: {
        result: { type: 'object', description: '更新后的分析结果JSON，必须包含 orders 数组。每个order需包含：contractNumber(订单编号)、customer(客户)、amount(金额万元)、shipmentRatio(发货率数字)、status(状态)、statusClass(blue/green/orange)、sales(销售员)、region(区域)、orderDate(下单日期)、problemCategories(问题分类数组)、deliveryTables(交付表格数组)。' },
      },
      required: ['result'],
    },
  },
}

async function handleUpdateAnalysisTask(
  args: Record<string, unknown>,
  ws: WebSocket,
  sessionId: string,
  skillName: string,
  contextTaskId?: string,
): Promise<{ text: string }> {
  if (!contextTaskId) {
    return { text: '当前对话未关联分析任务，无法执行更新操作。请先创建分析任务。' }
  }

  const result = args.result as Record<string, unknown> | undefined
  if (!result || !hasOrdersInResult(result)) {
    return { text: '更新失败：result 参数必须包含 orders 数组。' }
  }

  // Fetch existing contract numbers to prevent the LLM from expanding scope
  const existingContracts = await fetchExistingOrderContracts(contextTaskId)
  const incomingOrders = result.orders as Array<{ contractNumber?: string; contract_number?: string }>
  const filteredOrders = incomingOrders.filter((o) => {
    const cn = o.contractNumber || o.contract_number || ''
    return existingContracts.has(cn)
  })
  const removedCount = incomingOrders.length - filteredOrders.length
  if (removedCount > 0) {
    console.log(`[AgentLoop] handleUpdateAnalysisTask: filtered out ${removedCount} new orders not in original analysis`)
  }

  const filteredResult = { ...result, orders: filteredOrders }
  const jsonToSave = JSON.stringify(filteredResult)
  const saved = await saveStructuredResult(contextTaskId, jsonToSave)
  if (!saved) {
    return { text: `更新分析任务（ID: ${contextTaskId}）失败，请稍后重试。` }
  }

  send(ws, {
    type: 'analysis_updated',
    sessionId,
    analysisId: contextTaskId,
    analysisTitle: String(args.title || skillName),
  })

  const summary = removedCount > 0
    ? `分析任务（ID: ${contextTaskId}）已更新。修正后的数据已保存。注：原分析包含 ${existingContracts.size} 个合同，更新请求中 ${removedCount} 个新合同被过滤（更新操作只允许修改已有合同的分析数据，不允许新增合同）。`
    : `分析任务（ID: ${contextTaskId}）已更新。修正后的数据已保存，用户可在看板分析tab中查看更新后的内容。`
  return { text: summary }
}

async function fetchExistingOrderContracts(taskId: string): Promise<Set<string>> {
  try {
    const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
    const res = await fetch(`${BACKEND_API}/analysis/${taskId}/full`)
    if (!res.ok) return new Set()
    const data = await res.json()
    const orders = data?.orders || []
    return new Set(orders.map((o: any) => o.contractNumber || o.contract_number || ''))
  } catch {
    return new Set()
  }
}

async function filterNewOrders(taskId: string, jsonStr: string): Promise<string> {
  try {
    const existing = await fetchExistingOrderContracts(taskId)
    if (existing.size === 0) return jsonStr
    const parsed = JSON.parse(jsonStr)
    if (!parsed.orders || !Array.isArray(parsed.orders)) return jsonStr
    const incoming = parsed.orders as Array<{ contractNumber?: string; contract_number?: string }>
    const filtered = incoming.filter((o) => {
      const cn = o.contractNumber || o.contract_number || ''
      return existing.has(cn)
    })
    if (filtered.length < incoming.length) {
      console.log(`[AgentLoop] filterNewOrders: filtered out ${incoming.length - filtered.length} new orders for task ${taskId}`)
    }
    return JSON.stringify({ ...parsed, orders: filtered })
  } catch {
    return jsonStr
  }
}

const GENERATE_TODOS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'generate_todos',
    description: '仅在用户明确要求时调用。为已有的分析任务生成待办执行清单。根据分析结果中的问题卡片，为每个问题生成具体的待办任务，包含任务描述、优先级、负责人、截止日期等。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '分析任务ID' },
      },
      required: ['taskId'],
    },
  },
}

function handleGenerateTodosTool(args: Record<string, unknown>, ws: WebSocket, sessionId: string, mcp: McpPool, signal?: AbortSignal): Promise<string> {
  const taskId = String(args.taskId || '')
  if (!taskId) {
    return Promise.resolve('Error: taskId 参数为必填项')
  }
  // Run todo generation inline — the function sends its own WS messages and saves results
  return generateTodosForTask(ws, `${sessionId}:todos`, taskId, '请为此分析任务生成待办清单', [], mcp, signal)
    .then(() => `待办清单已生成并保存到分析任务 ${taskId}`)
    .catch((err) => `生成待办清单失败: ${err.message}`)
}

// ── Plan Mode ──

const planModeSessions = new Set<string>()

const PLANS_DIR = path.resolve(process.cwd(), 'plans')

// Tools always available even in plan mode
const PLAN_MODE_ALWAYS_TOOLS = new Set(['enter_plan_mode', 'save_plan', 'todo_write'])

// Read-only tools available in plan mode
const PLAN_MODE_READ_TOOLS = new Set([
  'fetch_orders', 'fetch_biz_data', 'search_material_stock',
  'get_pending_todos', 'list_notification_channels',
])

function isPlanMode(sessionId: string): boolean {
  return planModeSessions.has(sessionId)
}

function enterPlanMode(sessionId: string): void {
  planModeSessions.add(sessionId)
}

function exitPlanMode(sessionId: string): void {
  planModeSessions.delete(sessionId)
}

const ENTER_PLAN_MODE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'enter_plan_mode',
    description: '进入计划模式（只读研究阶段）。在此模式下只能使用只读工具（查询数据、搜索、读取文件），不能进行任何修改操作。适用于在实施复杂任务前先研究分析、制定详细计划。计划制定完成后调用 save_plan 保存计划并退出计划模式。',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '计划目标，简要描述你想要调研并规划的内容（如"改造定时任务模块的 schedule 选择器"）' },
      },
      required: ['goal'],
    },
  },
}

function handleEnterPlanMode(args: Record<string, unknown>, sessionId: string, ws: WebSocket): string {
  const goal = String(args.goal || '未指定目标')
  enterPlanMode(sessionId)
  send(ws, { type: 'plan_mode', sessionId, phase: 'entered', goal } as any)

  // Inject a strong planning instruction into the conversation.  This is
  // appended as a system message (cache-safe — doesn't change the tool
  // prefix) rather than filtering tools (which would invalidate the cache).
  // Matches Claude Code's approach where plan mode is a conversation-level
  // constraint, not a tool-list mutation.
  const session = sessions.get(`${sessionId}:analysis-assistant`)  // best-effort lookup
  if (session) {
    session.messages.push({
      role: 'system',
      content: `[PLAN MODE ACTIVE — READ-ONLY RESEARCH PHASE]

You are now in plan mode. Goal: ${goal}

CRITICAL CONSTRAINT: You MUST NOT use any write/modify tools. This includes but is not limited to: save_skill, save_hook, send_notification, mark_task_complete, create_analysis_task, update_analysis_task, generate_todos, show_analysis_result, and any MCP write tools (Write, Edit, bash with write operations, etc.).

ALLOWED tools: todo_write, fetch_orders, fetch_biz_data, search_material_stock, get_pending_todos, list_notification_channels, and read-only MCP tools (Read, Grep, Glob, search, list, find, etc.).  Use these to research and analyze.

Workflow:
1. Use todo_write to create research tasks
2. Research each task thoroughly using read-only tools
3. When research is complete, call save_plan with a structured plan document

The plan document MUST follow this format:
\`\`\`markdown
# [Plan Title]

## Context
[Current state, background, why change is needed]

## 改动
### 1. [Change item] — \`file/path.ts\`
**当前**：[current behavior]
**改为**：[new behavior]
**实现**：[how to implement]

## 涉及文件
| 文件 | 操作 | 说明 |
|------|------|------|
| path/to/file | 修改/新建/删除 | description |

## 验证
1. [Verification step]
\`\`\`

The plan will be saved to agent-service/plans/ for user review before implementation.`,
    })
  }

  return `已进入计划模式。目标：${goal}

计划模式规则：
1. 你现在处于只读研究阶段——可以查询数据、搜索、分析，但**不能修改任何代码或数据**
2. 请先全面研究相关代码结构和影响范围，然后用 todo_write 列出研究任务并逐一完成
3. 研究充分后，调用 save_plan 生成结构化计划文档，格式参考：
   - # 计划标题
   - ## Context（当前状态和背景）
   - ## 改动（逐项描述：当前→改为→实现方式）
   - ## 涉及文件（表格列出所有要改的文件及操作）
   - ## 验证（验收步骤清单）
4. 计划文档将保存到 agent-service/plans/ 目录，用户审批后可进入实施阶段`
}

const SAVE_PLAN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_plan',
    description: '保存计划文档并退出计划模式。仅在完成充分研究后调用。计划文档将保存为 markdown 文件到 plans/ 目录。调用后自动退出计划模式，恢复所有工具的完整访问权限。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '计划标题（简洁明了，如"定时任务模块优化 + 任务督办助手绑定"）' },
        content: { type: 'string', description: '完整的计划文档内容（Markdown 格式）。必须包含：Context（背景）、改动（逐项详细描述）、涉及文件（表格）、验证（验收步骤）四部分。' },
      },
      required: ['title', 'content'],
    },
  },
}

function handleSavePlan(args: Record<string, unknown>, sessionId: string, ws: WebSocket): string {
  const title = String(args.title || '未命名计划')
  const content = String(args.content || '')

  if (!content.trim()) {
    return 'Error: content 为必填项，请提供完整的计划文档内容'
  }

  try {
    // Ensure plans directory exists
    if (!fs.existsSync(PLANS_DIR)) {
      fs.mkdirSync(PLANS_DIR, { recursive: true })
    }

    // Generate filename: slugify title, prefix with date
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const slug = title
      .replace(/[^\w一-鿿]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase()
    const filename = `${dateStr}-${slug}.md`
    const filePath = path.join(PLANS_DIR, filename)

    // Build full markdown document with frontmatter
    const fullDoc = [
      '---',
      `title: "${title}"`,
      `created: ${new Date().toISOString()}`,
      `sessionId: ${sessionId}`,
      'status: pending',
      '---',
      '',
      content,
    ].join('\n')

    fs.writeFileSync(filePath, fullDoc, 'utf-8')

    exitPlanMode(sessionId)

    // Notify frontend
    send(ws, {
      type: 'plan_saved',
      sessionId,
      planTitle: title,
      planPath: filePath,
      planContent: content,
    } as any)

    console.log(`[AgentLoop] Plan saved: ${filePath}`)
    return `✅ 计划已保存到 \`${filePath}\`，已退出计划模式。

计划标题：${title}
计划状态：待审批（pending）

用户可以在界面中查看计划内容，审批通过后即可开始实施。`
  } catch (err: any) {
    return `Error saving plan: ${err.message}`
  }
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

    // Record old statuses to detect newly completed tasks
    const oldStatuses = new Map<string, string>()
    for (const t of existing) {
      oldStatuses.set(t.id, t.status)
    }

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

    // Persist tasks to DB
    if (sessionStore) {
      sessionStore.saveTasks(sessionId, merged)
    }

    // Queue task_boundary for tasks newly marked as completed (flushed before next iteration's text)
    for (const item of todos) {
      const oldStatus = oldStatuses.get(item.id)
      if (item.status === 'completed' && oldStatus && oldStatus !== 'completed') {
        if (!pendingBoundaries.has(sessionId)) {
          pendingBoundaries.set(sessionId, [])
        }
        pendingBoundaries.get(sessionId)!.push({
          taskId: item.id,
          taskContent: item.content || item.id,
          verified: item.verified,
        })
      }
    }

    const counts = { pending: 0, in_progress: 0, completed: 0 }
    for (const t of merged) {
      if (t.status === 'pending') counts.pending++
      if (t.status === 'in_progress') counts.in_progress++
      if (t.status === 'completed') counts.completed++
    }

    return `Todo list updated. ${counts.completed} completed, ${counts.in_progress} in progress, ${counts.pending} pending. Use blockedBy field (array of task ids) to declare dependencies.`
  } catch (err: any) {
    return `Error: ${err.message}`
  }
}

function flushPendingBoundaries(ws: WebSocket, sessionId: string) {
  const boundaries = pendingBoundaries.get(sessionId)
  if (boundaries && boundaries.length > 0) {
    for (const b of boundaries) {
      send(ws, { type: 'task_boundary', sessionId, taskId: b.taskId, taskContent: b.taskContent, verified: b.verified })
    }
    pendingBoundaries.delete(sessionId)
  }
}

async function saveChatHistory(sessionId: string, messages: Session['messages']) {
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

async function generateSessionTitle(sessionId: string, messages: Session['messages']) {
  try {
    // Extract user + assistant messages for summarization
    const convo = messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.trim().slice(0, 300)}`)

    if (convo.length < 2) return

    const convoText = convo.join('\n').slice(0, 3000)
    const modelId = getDefaultModel()
    const provider = getProviderForModel(modelId)
    if (!provider) return

    // Timeout after 15 seconds to avoid blocking the agent loop
    const result = await Promise.race([
      chatCompletion(
        {
          model: modelId,
          messages: [
            { role: 'system', content: '你是一个标题生成器。根据对话内容生成一个简短的会话标题（不超过15个字）。只输出标题文本，不要有任何额外说明、标点或引号。' },
            { role: 'user', content: `为以下对话生成一个简短的会话标题：\n\n${convoText}` },
          ],
          temperature: 0.3,
        },
        {
          apiKey: provider.apiKey,
          apiUrl: provider.apiUrl,
          model: modelId,
        },
      ),
      new Promise<{ content: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Title generation timeout after 15s')), 15000)
      ),
    ])

    const title = (result.content || '').trim().slice(0, 50)
    if (!title) return

    const putRes = await fetch(`${BACKEND_API}/chat/${sessionId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!putRes.ok) {
      console.error(`[AgentLoop] Failed to update title: ${putRes.status} ${putRes.statusText}`)
      return
    }
    console.log(`[AgentLoop] Generated session title for ${sessionId}: "${title}"`)
  } catch (err) {
    console.error('[AgentLoop] Failed to generate session title:', err)
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

  // Restore persisted tasks if not already loaded
  if (!todoStores.has(sessionId) && sessionStore) {
    const savedTasks = sessionStore.loadTasks(sessionId)
    if (savedTasks.length > 0) {
      todoStores.set(sessionId, savedTasks)
    }
  }

  return sessions.get(key)!
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId)
  pendingBoundaries.delete(sessionId)
  exitPlanMode(sessionId)
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

async function fetchCabinetPackageData(ids: string[]): Promise<string> {
  if (ids.length === 0) return ''
  try {
    const res = await fetch(`${BACKEND_API}/cabinet-packages?page=1&pageSize=100`)
    if (!res.ok) return ''
    const { data } = await res.json()
    const relevant = data.filter((c: any) => ids.includes(c.id))
    if (relevant.length === 0) return ''
    return JSON.stringify(relevant, null, 2)
  } catch {
    return ''
  }
}

async function createAnalysisTask(title: string, agentName: string, skillId: string, orders: string[]): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`${BACKEND_API}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, orders, agent: agentName, skillId, skillName: agentName }),
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
          content: `你是一个意图分类器。根据用户的消息，从以下Skill中选择最合适的一个来处理该请求。只回复Skill的 id（如 "product-revenue"），不要回复其他内容。\n\n可用的Skill：\n${skillList}`,
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
  const { sessionId, message, orders, cabinetPackages, autoAssign, taskId, currentPage } = msg
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
  let totalTokens = { prompt: 0, completion: 0, cachedPrompt: 0, uncachedPrompt: 0 }

  try {

  // Route: frontend button sends taskId with todo generation request message
  if (taskId && message.startsWith('请为以下合同生成待办清单')) {
    await generateTodosForTask(ws, sessionId, taskId, message, orders || [], mcp, abortController.signal)
    return
  }

  // When user is on an existing analysis page, carry taskId through as context
  // so the agent updates the existing task instead of creating a new one.
  const contextTaskId = taskId || undefined

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

  // Clear previous task list and plan mode for this session when starting a new conversation
  todoStores.delete(sessionId)
  exitPlanMode(sessionId)
  send(ws, { type: 'todo_list', sessionId, todos: [] })

  // Send initial status with context window
  const modelInfo = getAllModels().find((m) => m.id === modelId)
  const contextWindow = modelInfo?.contextWindow
  send(ws, { type: 'status', sessionId, status: 'thinking', skillName: skill.name, skillIcon: skill.icon, skillColor: skill.color, modelId, contextWindow })

  const enableA2ui = shouldEnableA2ui(message, skill)
  const systemPrompt = buildSystemPrompt(skill, orders, currentPage, enableA2ui)
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
  if (cabinetPackages && cabinetPackages.length > 0) {
    const cabinetData = await fetchCabinetPackageData(cabinetPackages)
    if (cabinetData) {
      userMessage += `\n\n以下是与选中机柜包相关的数据（JSON 格式）：\n\`\`\`json\n${cabinetData}\n\`\`\``
    } else {
      userMessage += `\n\n[关联机柜包] ${cabinetPackages.join(', ')}`
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

  const BUILTIN_NAMES = new Set(['todo_write', 'save_skill', 'save_hook', 'send_notification', 'list_notification_channels', 'get_pending_todos', 'generate_todos', 'show_analysis_result', 'create_analysis_task', 'update_analysis_task', 'fetch_biz_data', 'fetch_orders', 'search_material_stock', 'mark_task_complete', 'enter_plan_mode', 'save_plan'])
    // Normalize function name for comparison (strip underscores, lowercase) to match built-in names
    const BUILTIN_NORMALIZED = new Set(Array.from(BUILTIN_NAMES).map((n) => n.toLowerCase().replace(/_/g, '')))
    const MCP_TOOLS_RAW = mcp.getTools().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }))
    const mcpTools = MCP_TOOLS_RAW.filter((t) => !BUILTIN_NORMALIZED.has(t.function.name.toLowerCase().replace(/_/g, '')))
    // Always include built-in tools; show_analysis_result only when A2UI is enabled
    const enabledNames = new Set(getEnabledTools(mcp).map((t) => t.name))
    const tools = [
      TODO_WRITE_TOOL,
      SAVE_SKILL_TOOL,
      SAVE_HOOK_TOOL,
      SEND_NOTIFICATION_TOOL,
      LIST_NOTIFICATION_CHANNELS_TOOL,
      FETCH_BIZ_DATA_TOOL,
      FETCH_ORDERS_TOOL,
      MARK_TASK_COMPLETE_TOOL,
      SEARCH_MATERIAL_STOCK_TOOL,
      GET_PENDING_TODOS_TOOL,
      CREATE_ANALYSIS_TASK_TOOL,
      GENERATE_TODOS_TOOL,
      ENTER_PLAN_MODE_TOOL,
      SAVE_PLAN_TOOL,
      ...(enableA2ui ? [SHOW_ANALYSIS_RESULT_TOOL] : []),
      ...mcpTools,
    ]
      .filter((t) => enabledNames.has(t.function.name) || BUILTIN_NAMES.has(t.function.name))
      // Plan mode: keep ALL tools available (cache-safe — avoids changing the
      // tool definition prefix between turns).  The enter_plan_mode handler
      // injects a strong system instruction that restricts the agent to
      // research/read-only behavior without altering the cached prefix.
      // This matches Claude Code's approach where EnterPlanMode/ExitPlanMode
      // are tools themselves and don't modify the tool list.

    console.log(`[AgentLoop] Starting streaming for ${skill.name} via ${modelId}`)

    let iteration = 0
    let finalContent = ''
    let analysisId: string | undefined
    let lastContextTokens = 0  // captured outside loop for final complete message
    const processedMarkers = new Set<string>()

    while (iteration < (isPlanMode(sessionId) ? MAX_ITERATIONS_PLAN_MODE : MAX_ITERATIONS)) {
      iteration++

      if (iteration > 1) {
        send(ws, { type: 'status', sessionId, status: 'calling_tool', skillName: skill.name, skillIcon: skill.icon, skillColor: skill.color, modelId })
        // Flush pending task_boundary events so next iteration's text goes into a new bubble
        flushPendingBoundaries(ws, sessionId)
      }

      // Stream LLM response
      let streamContent = ''
      let reasoningContent = ''
      let iterationPromptTokens = 0
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
          if (m.role === 'assistant' && m.reasoningContent != null) {
            base.reasoning_content = m.reasoningContent
          }
          return base
        }),
        temperature: 0.7,
        tools: tools.length > 0 ? tools : undefined,
      }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl, signal: abortController.signal })) {

        // Accumulate reasoning content (DeepSeek R1 thinking mode)
        if (chunk.reasoningContent != null) {
          reasoningContent += chunk.reasoningContent
        }

        // Accumulate text content; stream to frontend incrementally, stripping TASK_COMPLETE markers
        if (chunk.content) {
          streamContent += chunk.content
          const cleanChunk = chunk.content.replace(/[\[<]TASK_COMPLETE:[^\s\[\]<>]+[\]>]?/g, '')
          if (cleanChunk) {
            send(ws, { type: 'chunk', content: cleanChunk, sessionId, taskId: getActiveTaskId(sessionId) })
          }
        }

        // Track usage — capture per-iteration prompt tokens (the actual input size
        // of this API call, which reflects the current context occupancy).
        // totalTokens accumulates for cost reporting; iterationPromptTokens is used
        // for compaction decisions and frontend context-usage display.
        if (chunk.usage) {
          iterationPromptTokens = chunk.usage.promptTokens
          totalTokens.prompt += chunk.usage.promptTokens
          totalTokens.completion += chunk.usage.completionTokens
          if (chunk.usage.cachedPromptTokens) totalTokens.cachedPrompt += chunk.usage.cachedPromptTokens
          if (chunk.usage.uncachedPromptTokens) totalTokens.uncachedPrompt += chunk.usage.uncachedPromptTokens
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

      // Emit task_boundary events for TASK_COMPLETE markers (content already streamed incrementally)
      const taskCompleteSplitRe = /[\[<]TASK_COMPLETE:([^\s\[\]<>]+)[\]>]?/g

      // Find all marker positions in streamContent
      const markerPositions: Array<{ index: number; endIndex: number; taskId: string }> = []
      let mc
      while ((mc = taskCompleteSplitRe.exec(streamContent)) !== null) {
        markerPositions.push({ index: mc.index, endIndex: mc.index + mc[0].length, taskId: mc[1] })
        if (!processedMarkers.has(mc[1])) {
          processedMarkers.add(mc[1])
        }
      }

      if (markerPositions.length > 0) {
        const todos = todoStores.get(sessionId) || []
        for (const mp of markerPositions) {
          flushPendingBoundaries(ws, sessionId)
          const task = todos.find(t => t.id === mp.taskId)
          send(ws, { type: 'task_boundary', sessionId, taskId: mp.taskId, taskContent: task?.content || '', verified: true })
        }
      }

      // Track tokens and check compaction after each LLM call.
      // Use iterationPromptTokens (the ACTUAL input size of this call) rather
      // than totalTokens.prompt (which accumulates across iterations and would
      // cause quadratic growth in the cumulative counter).
      const willCompact = iterationPromptTokens >= Math.floor((contextWindow ?? 128000) * 0.8)
      if (willCompact) {
        send(ws, { type: 'compacting', sessionId, phase: 'start' })
      }
      await trackTokensAndCompact(sessionKey, session, iterationPromptTokens, modelId, ws, sessionId)
      if (willCompact) {
        send(ws, { type: 'compacting', sessionId, phase: 'done' })
      }
      // Send context usage update — use the latest call's input size as the
      // best estimate of current context occupancy (not cumulative, which
      // double-counts messages sent in every API call).
      send(ws, { type: 'context_update', sessionId, promptTokens: iterationPromptTokens, contextWindow })
      lastContextTokens = iterationPromptTokens  // capture for final complete message

      // Process accumulated tool calls
      const toolCallsArr = Array.from(accumulatedToolCalls.values())
      if (toolCallsArr.length > 0) {
        // Strip TASK_COMPLETE markers from saved content (both [TASK_COMPLETE:id] and <TASK_COMPLETE:id>)
        const cleanContent = streamContent.replace(/[\[<]TASK_COMPLETE:[^\s\[\]<>]+[\]>]?/g, '')
        pushMessage(sessionKey, session, {
          role: 'assistant',
          content: cleanContent,
          reasoningContent: reasoningContent || undefined,
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

        // Normalize tool name for comparison (handle PascalCase + underscores from MCP)
        const normalizedName = toolName.toLowerCase().replace(/_/g, '')
        // Handle built-in todo_write tool
        if (normalizedName === 'todowrite') {
            const resultText = handleTodoWrite(toolArgs, sessionId, ws)
            console.log('[AgentLoop] todo_write CALLED with args:', JSON.stringify(toolArgs).slice(0, 300))
            console.log('[AgentLoop] todo_write result:', resultText)
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
          if (normalizedName === 'saveskill') {
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
          if (normalizedName === 'savehook') {
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
          if (normalizedName === 'showanalysisresult') {
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

          // Handle built-in create_analysis_task tool
          if (normalizedName === 'createanalysistask') {
            const result = await handleCreateAnalysisTask(toolArgs, ws, sessionId, skill.name, skill.id, orders || [], currentPage, session.messages, contextTaskId)
            if (result.taskId) {
              analysisId = result.taskId
            }
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: result.text,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: result.text.slice(0, 200),
            })
            continue
          }

          // Handle built-in update_analysis_task tool
          if (normalizedName === 'updateanalysistask') {
            const result = await handleUpdateAnalysisTask(toolArgs, ws, sessionId, skill.name, contextTaskId)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: result.text,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: result.text.slice(0, 200),
            })
            continue
          }

          // Handle built-in send_notification tool
          if (normalizedName === 'sendnotification') {
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
          if (normalizedName === 'listnotificationchannels') {
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

          // Handle built-in search_material_stock tool
          if (normalizedName === 'searchmaterialstock') {
            const resultText = await handleSearchMaterialStock(toolArgs)
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

          // Handle built-in fetch_biz_data tool
          if (normalizedName === 'fetchbizdata') {
            const resultText = await handleFetchBizData(toolArgs)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: '业务数据已获取',
            })
            continue
          }

          // Handle built-in fetch_orders tool
          if (normalizedName === 'fetchorders') {
            const resultText = await handleFetchOrders(toolArgs)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: '订单数据已获取',
            })
            continue
          }

          // Handle built-in mark_task_complete tool
          if (normalizedName === 'marktaskcomplete') {
            const resultText = await handleMarkTaskComplete(toolArgs, ws, sessionId)
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

          // Handle built-in get_pending_todos tool
          if (normalizedName === 'getpendingtodos') {
            const resultText = await handleGetPendingTodos(toolArgs)
            pushMessage(sessionKey, session, {
              role: 'tool',
              content: resultText,
              toolCallId: toolCall.id,
            })
            send(ws, {
              type: 'tool_result',
              sessionId,
              toolName,
              toolOutput: '待办数据已获取',
            })
            continue
          }


          // Handle built-in generate_todos tool
          if (normalizedName === 'generatetodos') {
            const resultText = await handleGenerateTodosTool(toolArgs, ws, sessionId, mcp, abortController.signal)
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

          // Handle enter_plan_mode — switch to read-only planning mode
          if (normalizedName === 'enterplanmode') {
            const resultText = handleEnterPlanMode(toolArgs, sessionId, ws)
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

          // Handle save_plan — persist plan to disk and exit plan mode
          if (normalizedName === 'saveplan') {
            const resultText = handleSavePlan(toolArgs, sessionId, ws)
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

      // No tool calls — final response. Flush any pending boundaries.
      flushPendingBoundaries(ws, sessionId)
      // Text already emitted above; save clean content for session
      const cleanFinal = streamContent.replace(/[\[<]TASK_COMPLETE:[^\s\[\]<>]+[\]>]?/g, '').trim()
      finalContent = cleanFinal || '抱歉，我未能生成有效的分析结果。'
      pushMessage(sessionKey, session, { role: 'assistant', content: finalContent, reasoningContent: reasoningContent || undefined })
      break
    }

    // Post-loop: extract structured JSON from final assistant response and persist to analysis task.
    // Skip only when user is already viewing an existing analysis page (contextTaskId).
    if (!contextTaskId) {
      const allAssistantContent = session.messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n')
      const structuredJson = extractStructuredJson(allAssistantContent)
      if (structuredJson) {
        if (analysisId) {
          // Task already created during the loop (LLM called create_analysis_task) —
          // save the final structured JSON which may contain the complete orders block.
          await saveStructuredResult(analysisId, structuredJson)
        } else {
          // No task created yet — auto-create one from the extracted JSON.
          const task = await createAnalysisTask(
            `${skill.name} — 履约分析`,
            skill.name,
            skill.id,
            orders || [],
          )
          if (task) {
            analysisId = task.id
            await saveStructuredResult(task.id, structuredJson)
            send(ws, {
              type: 'analysis_created',
              sessionId,
              analysisId: task.id,
              analysisTitle: `${skill.name} — 履约分析`,
              redirect: `/analysis/${task.id}`,
            })
          }
        }
      } else if (!analysisId) {
        console.warn('[AgentLoop] No structured JSON found in assistant messages for session', sessionId)
      }
    }

    const elapsed = Date.now() - startTime

    // Persist full chat history (all roles: user, assistant, tool; plus tool metadata)
    const chatMsgs = session.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      }))
    await saveChatHistory(sessionId, chatMsgs)
    // Also save under the analysis task ID so the analysis page can load it
    if (analysisId && analysisId !== sessionId) {
      saveChatHistory(analysisId, chatMsgs)
    }
    // Generate an LLM-based summary title for the conversation (must be after saveChatHistory completes)
    await generateSessionTitle(sessionId, chatMsgs)

    // Run after_chat hooks
    const afterChatCtx = { sessionId, skillId: skill.id, skillName: skill.name, message: finalContent }
    const afterChatResults = await runHooks('after_chat', afterChatCtx)
    for (const hr of afterChatResults) {
      if (hr.modifiedContext?.message) {
        finalContent = hr.modifiedContext.message as string
      }
    }

    // ── Task verification ──
    const tasks = todoStores.get(sessionId) || []
    const incompleteTasks: string[] = []
    if (tasks.length > 0) {
      // Verify completed tasks
      const allAssistantContent = session.messages
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .join('\n')
      const hasAnalysisJson = !!extractStructuredJson(allAssistantContent)

      let tasksUpdated = false
      for (const t of tasks) {
        if (t.status === 'completed' && t.verified === undefined) {
          // Only verify if we have data to check against; otherwise leave as unchecked
          if (hasAnalysisJson || analysisId) {
            t.verified = true
            tasksUpdated = true
          }
        }
        if (t.status === 'in_progress') {
          // Reset in_progress to pending since this agent turn ended
          t.status = 'pending'
          tasksUpdated = true
        }
        if (t.status !== 'completed') {
          // Check if blockedBy dependencies are all completed
          if (t.blockedBy && t.blockedBy.length > 0) {
            const depsMet = t.blockedBy.every(did => {
              const dep = tasks.find(dt => dt.id === did)
              return dep && dep.status === 'completed'
            })
            if (!depsMet) {
              incompleteTasks.push(`${t.id}: ${t.content} (依赖未满足)`)
            }
          } else {
            incompleteTasks.push(`${t.id}: ${t.content}`)
          }
        }
      }
      if (tasksUpdated) {
        send(ws, { type: 'todo_list', sessionId, todos: tasks })
        if (sessionStore) {
          sessionStore.saveTasks(sessionId, tasks)
        }
      }
    }

    // Record token usage for project-level tracking (like Claude Code /cost)
    if (sessionStore && totalTokens.prompt + totalTokens.completion > 0) {
      try {
        sessionStore.recordTokenUsage(
          sessionKey, sessionId, modelId, msg.userId || '',
          totalTokens.prompt, totalTokens.completion,
          totalTokens.cachedPrompt || 0, totalTokens.uncachedPrompt || 0,
        )
      } catch { /* best-effort */ }
    }

    // Send complete with full stats
    send(ws, {
      type: 'complete',
      sessionId,
      analysisId,
      redirect: analysisId ? `/analysis/${analysisId}` : undefined,
      hasStructuredResult: !!analysisId,
      elapsed,
      totalTokens: totalTokens.prompt + totalTokens.completion,
      promptTokens: lastContextTokens || totalTokens.prompt,
      completionTokens: totalTokens.completion,
      contextWindow,
      skillName: skill.name,
      skillIcon: skill.icon,
      skillColor: skill.color,
      modelId,
      taskId: getActiveTaskId(sessionId),
      incompleteTasks: incompleteTasks.length > 0 ? incompleteTasks : undefined,
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
    pendingBoundaries.delete(sessionId)
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
    send(ws, { type: 'error', content: `Model not found: ${modelId}`, sessionId, taskId })
    return
  }

  send(ws, { type: 'status', sessionId, status: 'thinking', skillName: '待办生成', modelId, taskId })

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
      "contractNumber": "订单合同编号（必须使用输入数据中提供的合同编号，如 HT202504001，不要自行拼接或修改）",
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

  // Build user message with explicit valid order IDs so LLM uses correct contractNumber
  let userContent = userMessage
  if (orders.length > 0) {
    userContent += `\n\n**重要：contractNumber 必须使用以下合同编号（原样使用，不要修改或拼接）：${orders.join('、')}**`
    const orderData = await fetchOrderData(orders)
    if (orderData) {
      userContent += `\n\n关联订单数据：\n\`\`\`json\n${orderData}\n\`\`\``
    }
  }
  pushMessage(todoSessionKey, session, { role: 'user', content: userContent })

  try {
    // Single-pass LLM call — no tools, LLM outputs JSON directly.
    // Avoiding tools prevents tool-calling loops and reasoning_content errors with thinking models.
    let streamContent = ''

    for await (const chunk of streamChat({
      model: modelId,
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: 0.3,
    }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl, signal })) {

      if (chunk.content) {
        streamContent += chunk.content
        send(ws, { type: 'chunk', content: chunk.content, sessionId, taskId })
      }
    }

    const finalContent = streamContent || '已生成待办清单。'
    pushMessage(todoSessionKey, session, { role: 'assistant', content: finalContent })

    // Extract todos JSON from response
    const todosJson = extractStructuredJson(finalContent)
    if (todosJson) {
      try {
        const parsed = JSON.parse(todosJson)
        if (parsed.todos && Array.isArray(parsed.todos)) {
          // Fix LLM-generated contractNumbers that don't match actual order IDs
          if (orders.length > 0) {
            parsed.todos = parsed.todos.map((todo: any) => {
              const cn = String(todo.contractNumber || '')
              // Already valid — keep as-is
              if (orders.includes(cn)) return todo
              // Try to find a matching order ID that is a substring of the generated contractNumber
              const match = orders.find((oid) => cn.includes(oid))
              if (match) return { ...todo, contractNumber: match }
              // Try the reverse: find the order ID in description/task text
              const descMatch = orders.find((oid) =>
                (todo.description || '').includes(oid) || (cn && oid.includes(cn))
              )
              if (descMatch) return { ...todo, contractNumber: descMatch }
              return todo
            })
          }
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
    send(ws, { type: 'error', content: `待办生成失败: ${err.message}`, sessionId, taskId })
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
    case 'create_analysis_task': return `创建分析任务: ${String(args.title || '')}`
    case 'update_analysis_task': return `更新分析任务数据`
    case 'generate_todos': return `生成待办清单: ${String(args.taskId || '')}`
    case 'send_notification': return `发送通知: ${String(args.channelId || '')}`
    case 'list_notification_channels': return `获取通知渠道列表`
    case 'get_pending_todos': return `获取待办任务清单`
    case 'fetch_biz_data': return `获取业务数据`
    case 'fetch_orders': return `获取订单列表`
    case 'mark_task_complete': return `标记任务完成: ${String(args.taskId || '')}`
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

  const systemPrompt = buildSystemPrompt(skill, undefined, 'cron')
  const tools = [
    SEND_NOTIFICATION_TOOL,
    LIST_NOTIFICATION_CHANNELS_TOOL,
    GET_PENDING_TODOS_TOOL,
    FETCH_BIZ_DATA_TOOL,
    FETCH_ORDERS_TOOL,
    MARK_TASK_COMPLETE_TOOL,
    SEARCH_MATERIAL_STOCK_TOOL,
  ]

  const messages: Array<{ role: string; content: string; reasoning_content?: string; toolCalls?: any; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]

  let finalContent = ''
  const MAX_ITERS = 10

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const response = await chatCompletion({
      model: modelId,
      messages: messages.map((m) => {
        const base: any = { role: m.role, content: m.content }
        if (m.role === 'assistant' && m.toolCalls) {
          base.tool_calls = m.toolCalls
        }
        if (m.role === 'assistant' && m.reasoning_content != null) {
          base.reasoning_content = m.reasoning_content
        }
        if (m.role === 'tool' && m.tool_call_id) {
          base.tool_call_id = m.tool_call_id
        }
        return base
      }),
      temperature: 0.7,
      tools,
    }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })

    // Save text content
    if (response.content) {
      finalContent = response.content
    }

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      break
    }

    // Record assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: response.content || '',
      reasoning_content: response.reasoningContent != null ? response.reasoningContent : undefined,
      toolCalls: response.toolCalls,
    })

    // Dispatch each tool call
    for (const tc of response.toolCalls) {
      const toolName = tc.function?.name || ''
      const normalizedName = toolName.toLowerCase().replace(/_/g, '')
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs = JSON.parse(tc.function?.arguments || '{}')
      } catch { /* ignore parse errors */ }

      console.log(`[AgentHTTP] Dispatching tool: ${toolName}`, JSON.stringify(toolArgs).slice(0, 200))

      let toolResult: string
      if (normalizedName === 'sendnotification') {
        toolResult = await handleSendNotification(toolArgs)
      } else if (normalizedName === 'listnotificationchannels') {
        toolResult = await handleListNotificationChannels()
      } else if (normalizedName === 'getpendingtodos') {
        toolResult = await handleGetPendingTodos(toolArgs)
      } else if (normalizedName === 'fetchbizdata') {
        toolResult = await handleFetchBizData(toolArgs)
      } else if (normalizedName === 'fetchorders') {
        toolResult = await handleFetchOrders(toolArgs)
      } else if (normalizedName === 'searchmaterialstock') {
        toolResult = await handleSearchMaterialStock(toolArgs)
      } else {
        toolResult = `Unknown tool: ${toolName}`
      }

      messages.push({
        role: 'tool',
        content: toolResult,
        tool_call_id: tc.id,
      })
    }
  }

  return { content: finalContent, skillName: skill.name }
}

function send(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function buildSystemPrompt(skill: Skill, orders?: string[], currentPage?: string, enableA2ui?: boolean): string {
  let prompt = `你是「${skill.name}」。\n\n${skill.prompt}\n\n`
  prompt += `当前时间: ${new Date().toLocaleString('zh-CN')}\n`
  prompt += `当前页面: ${currentPage || '未知'}\n`
  prompt += `\n## 页面感知规则（严格遵守）\n`
  prompt += `- 只有当前页面为"home"（首页）时，才能调用 create_analysis_task 创建新的分析任务。\n`
  prompt += `- 在"analysis"（分析任务详情页）或其他页面时，对话围绕当前页面的数据展开，禁止创建新的分析任务。\n`
  prompt += `- 如果是定时任务触发（currentPage === 'cron'），按定时任务自身的规则执行。\n\n`
  prompt += `你可以使用以下工具来完成任务:\n`
  prompt += `- Skill: 加载其他 skill 定义\n`
  prompt += `- read_file: 读取文件内容\n`
  prompt += `- todo_write: 创建和管理任务列表\n`
  prompt += `- save_skill: 将新创建的 Skill 保存到文件系统（skillId、name、description、icon、color、prompt 六个必填参数，可选的 references 数组和 scripts 数组用于创建参考文档和脚本文件）\n`
  prompt += `- save_hook: 将新创建的 Hook 保存到文件系统（hookId、name、description、event、script 五个必填参数，enabled 和 matcher 可选）\n`
  if (enableA2ui) prompt += '- show_analysis_result: 【严格限制】仅在用户明确要求"生成图表"、"可视化展示"、"看板"、"仪表盘"、"生成分析页面"等时才调用。普通文字分析、数据查询、状态检查等常规任务禁止调用此工具。参数：title（面板标题）、a2uiMessages（A2UI 消息数组）、taskId（可选，关联的分析任务ID）\n'
  prompt += `- create_analysis_task: 【仅限首页调用】只有当用户当前位于首页（currentPage === 'home'）时才能调用此工具。在分析任务详情页或其他页面时，禁止创建新的分析任务。参数：title（任务标题）、result（包含 orders 数组的JSON对象，每个order含 contractNumber/customer/amount/shipmentRatio/status/statusClass/sales/region/orderDate/problemCategories/deliveryTables 等字段）。\n`
  prompt += `- update_analysis_task: 更新已有分析任务的结构化数据。当用户在分析任务详情页（currentPage === 'analysis'）指出分析有误或需要修正时调用。参数：result（修正后的完整分析结果JSON，包含 orders 数组）。此工具覆盖现有数据，不会创建新任务。\n`
  prompt += `- generate_todos: 当用户消息以"请为以下合同生成待办清单"开头时（这是用户点击了界面按钮），必须调用此工具。其他场景仅在用户直接要求"生成待办清单"、"创建执行任务"时才调用。参数：taskId（分析任务ID）。注意：此工具运行较慢，会额外调用 LLM 生成待办\n`
  prompt += `- list_notification_channels: 列出所有已配置的通知渠道（飞书机器人、邮件、企微等）。在发送通知前先调用此工具确认可用的渠道。\n`
  prompt += `- send_notification: 通过通知渠道发送消息。参数：channelId（渠道ID，从 list_notification_channels 获取）、subject（标题，用于邮件）、message（消息正文，支持 Markdown 格式，飞书和企微机器人会渲染 Markdown）。\n`
  prompt += `- fetch_biz_data: 查询业务合同/装置/包/物料的层级数据。参数：contractId（合同ID）或 packageId（包ID）。\n`
  prompt += `- fetch_orders: 获取销售订单列表，支持多种筛选条件。参数（均为可选）：brand（品牌）、salesperson（销售员）、shipMethod（发货方式：直发客户/集货发货/中转仓发货/海外直发）、receiptStatus（签收状态：未签收/部分签收/全部签收）、deliveryStatus（出库状态：待出库/已出库/部分出库）、isException（是否异常订单）、customer（客户主体）、pageSize（每页数量，默认100）。返回订单列表含订单编号、客户、品牌、金额、发货率、签收率、发货方式、异常标记等字段。\n`
  prompt += `- search_material_stock: 按物料编码搜索所有合同中的库存分布。参数：materialCode（物料编码如DLQ-001）。返回每个合同的库存、在途、优先级、富余量(surplus)，用于判断调拨可行性。\n`
  prompt += `- get_pending_todos: 获取所有未完成的待办任务清单（含分析任务生成的待办和执行任务中的未完结待办）。按负责人分组，包含任务类别、描述、优先级、截止日期。可选参数 assignee 按人筛选。\n\n`

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


  // A2UI component reference — SIMPLIFIED FORMAT (system auto-converts to A2UI v0.9 wire format)
  prompt += `## A2UI 可视化报表\n`
  prompt += `show_analysis_result 工具的 a2uiMessages 参数是一个数组，使用以下简化格式（系统会自动转换为 A2UI v0.9）：\n\n`
  prompt += `**消息1 - 创建表面：** {"type":"createSurface","surfaceId":"main"}\n`
  prompt += `**消息2 - 定义组件：** {"type":"updateComponents","surfaceId":"main","components":[...]}\n`
  prompt += `**消息3 - 填充数据：** {"type":"updateDataModel","surfaceId":"main","value":{...}}\n\n`
  prompt += `**组件类型（每个节点必须有 id 和 type）：**\n`
  prompt += `- {"id":"t1","type":"Text","text":"标题","size":"3xl"}  可用 size: xs|sm|md|lg|xl|2xl|3xl\n`
  prompt += `- {"id":"r1","type":"Row","children":["id1","id2"],"gap":8}\n`
  prompt += `- {"id":"c1","type":"Column","children":[...],"gap":12}\n`
  prompt += `- {"id":"card1","type":"Card","children":[{"id":"ct","type":"Text","text":"..."}]}\n`
  prompt += `- {"id":"tbl1","type":"Table","columns":[{"key":"name","label":"名称"}],"rows":[{"name":"值"}]}\n`
  prompt += `  表格数据也可用数据绑定: "rows":{"path":"/tableData"} (需在 updateDataModel 中提供)\n`
  prompt += `- {"id":"ch1","type":"Chart","chartType":"bar","xKey":"date","yKeys":["supply","demand"],"colors":["#3b82f6","#ef4444"],"labels":["供给","需求"],"rows":[{"date":"05-22","supply":10,"demand":5}]}\n`
  prompt += `  Chart 也可用数据绑定: "rows":{"path":"/chartData"}\n`
  prompt += `  Chart 类型: "bar"=柱状图, "line"=折线图, "mixed"=混合图（第一个 yKey 用柱状，其余用折线）\n`
  prompt += `- {"id":"tag1","type":"Tag","text":"标签文字","color":"#10b981"}\n`
  prompt += `- {"id":"prog1","type":"ProgressBar","value":65,"max":100,"text":"65%"}\n`
  prompt += `- {"id":"div1","type":"Divider"}\n\n`
  prompt += `**常用颜色：** 绿色:#10b981 红色:#ef4444 橙色:#f59e0b 蓝色:#3b82f6 灰色:#6b7280\n\n`
  prompt += `**重要限制：** 只能使用以上列出的组件类型（Text/Row/Column/Card/Table/Chart/Tag/ProgressBar/Divider）。\n`
  prompt += `禁止使用 header、heading、title、row、section、container、panel、cell、label、spacer 等未列出的类型。\n`
  prompt += `如需标题用 Text + size 属性（如 {"id":"t1","type":"Text","text":"标题","size":"xl"}），如需分组用 Column 或 Card，表格行数据直接放入 Table 的 rows 数组。\n\n`
  prompt += `**通用示例（根据实际分析场景替换卡片标题、表格列名、图表数据）：**\n`
  prompt += `\`\`\`json\n`
  prompt += `[\n`
  prompt += `  {"type":"createSurface","surfaceId":"main"},\n`
  prompt += `  {"type":"updateComponents","surfaceId":"main","components":[\n`
  prompt += `    {"id":"root","type":"Column","children":["cards","table1","chart1"],"gap":16},\n`
  prompt += `    {"id":"cards","type":"Row","children":["c1","c2","c3"],"gap":12},\n`
  prompt += `    {"id":"c1","type":"Card","children":[\n`
  prompt += `      {"id":"c1t","type":"Column","children":["c1l","c1v"],"gap":4},\n`
  prompt += `      {"id":"c1l","type":"Text","text":"指标名称（如：发货率）","size":"sm"},\n`
  prompt += `      {"id":"c1v","type":"Text","text":"85%","size":"3xl"}\n`
  prompt += `    ]},\n`
  prompt += `    {"id":"c2","type":"Card","children":[...]},\n`
  prompt += `    {"id":"c3","type":"Card","children":[...]},\n`
  prompt += `    {"id":"table1","type":"Table","columns":[{"key":"col1","label":"列名1"},{"key":"col2","label":"列名2"}],"rows":{"path":"/tableData"}},\n`
  prompt += `    {"id":"chart1","type":"Chart","chartType":"bar","xKey":"category","yKeys":["val1","val2"],"colors":["#3b82f6","#ef4444"],"labels":["系列1","系列2"],"rows":{"path":"/chartData"}}\n`
  prompt += `  ]},\n`
  prompt += `  {"type":"updateDataModel","surfaceId":"main","value":{"tableData":[...],"chartData":[...]}}\n`
  prompt += `]\n`
  prompt += `\`\`\`\n`
  prompt += `重要：Card 标题、Table columns、Chart yKeys/labels 必须根据实际分析内容动态生成，不要照搬示例中的占位名。数据绑定用 {"path":"/key"} 引用 updateDataModel 中的数据。\n\n`

  // ── Task execution protocol ──
  prompt += `## 任务规划与执行规范（强制要求）\n`
  prompt += `当遇到复杂问题、多步骤任务、或用户明确要求"列出步骤"时，你**必须**遵循以下流程：\n\n`
  prompt += `**第一步：创建任务列表**\n`
  prompt += `立即调用 todo_write，列出你要完成的所有步骤。每个步骤作为一个任务，status 设为 "pending"。\n`
  prompt += `例如：todo_write({ todos: [\n`
  prompt += `  {id:"1", content:"查询数据", status:"pending"},\n`
  prompt += `  {id:"2", content:"分析原因", status:"pending"},\n`
  prompt += `  {id:"3", content:"生成报告", status:"pending"}\n`
  prompt += `] })\n`
  prompt += `系统会在界面上显示一个多任务看板，让用户看到你的执行进度。\n\n`
  prompt += `**第二步：逐项执行**\n`
  prompt += `1. 调用 todo_write 将当前任务标记为 "in_progress"（一次只有一个 in_progress 任务）\n`
  prompt += `2. 执行该任务需要的工具调用（fetch_biz_data、shell 命令等）\n`
  prompt += `3. 任务完成后，**先验证**：检查工具调用是否成功、产出数据是否完整\n`
  prompt += `4. 验证通过后调用 todo_write 将该任务标记为 "completed"\n`
  prompt += `5. **在回复末尾**输出标记 \`[TASK_COMPLETE:<任务id>]\` 表示此任务结束\n`
  prompt += `6. 然后再开始下一个任务\n\n`

  prompt += `## 任务输出分隔规范（强制要求）\n`
  prompt += `每个任务的输出**必须**独立成段：\n`
  prompt += `- 完成一个任务后，输出 \`[TASK_COMPLETE:任务id]\` 标记\n`
  prompt += `- 标记之后，用空行分隔，再开始下一个任务的输出\n`
  prompt += `- 每个任务的开头建议标注任务名称，如「## 任务1: 分析订单概况」\n`
  prompt += `- 这样系统会将不同任务的输出分开展示，便于阅读\n\n`

  prompt += `## 任务验证规范\n`
  prompt += `每完成一个任务后，在标记 [TASK_COMPLETE] 之前：\n`
  prompt += `1. 检查工具调用是否成功（无错误输出）\n`
  prompt += `2. 检查产出数据是否完整（字段齐全、数值合理）\n`
  prompt += `3. 补充验证结论：如「已验证：订单数据完整，共 60 条记录」\n`
  prompt += `4. 如发现问题，修正后再标记完成，不要带着错误进入下一个任务\n\n`

  if (orders && orders.length > 0) {
    prompt += `\n用户已选中订单: ${orders.join(', ')}。你将收到这些订单的业务数据。\n`
    prompt += `重要：订单数据中的 "id" 字段是订单在系统中的唯一编号（如 HT202598001），请在分析中始终使用 "id" 字段值来指代订单。"contractNumber" 是合同号，不要将其作为订单编号使用。\n`
  }

  prompt += `\n请用中文回复。`

  // ── Analysis result persistence — format depends on skill type ──
  const isKitCheck = skill.id === 'kit-check-analysis'

  if (isKitCheck) {
    // Kit-check: LLM must call create_analysis_task tool explicitly with package-level result
    prompt += `\n\n## 分析结果持久化（强制要求）`
    prompt += `\n你必须调用 \`create_analysis_task\` 工具来创建分析任务。该工具的 result 参数使用包级齐套看板 JSON 格式（以包为卡片、以齐套状态为泳道）。`
    prompt += `\n格式详见你的 skill prompt 中的「create_analysis_task 的 result 参数」章节。`
    prompt += `\n不要依赖系统自动提取——你必须主动调用 create_analysis_task 工具。`
  } else {
    // Default: order fulfillment analysis — call create_analysis_task tool
    prompt += `\n\n## 分析结果持久化（强制要求）`
    prompt += `\n完成分析后，你必须调用 \`create_analysis_task\` 工具将结果保存到数据库。`
    prompt += `\n该工具的 result 参数是一个包含 orders 数组的 JSON 对象。每个 order 必须包含 problemCategories（问题看板卡片数据），不能为空数组。`

    prompt += `\n\n**result 参数格式（字段名使用 camelCase，problemCategories 中用 problems 不是 cards）：**`
    prompt += `\n{"orders":[{"contractNumber":"<订单编号>","customer":"<客户>","amount":247.3,"shipmentRatio":96,"status":"发货中","statusClass":"green","sales":"<销售员>","region":"<区域>","orderDate":"<日期>","problemCategories":[{"name":"<问题分类名>","type":1,"problems":[{"materialCode":"<物料编码>","materialName":"<物料名称>","partName":"<部件名>","partNumber":"<部件编号>","tags":[{"label":"待处理","variant":"pill"}]}]}],"deliveryTables":[]}]}`

    prompt += `\n\n**字段说明：**`
    prompt += `\n- statusClass：blue=待发货、green=进行中、orange=待确认`
    prompt += `\n- problemCategories 必须包含至少1个分类，每个分类的 problems 数组至少1个元素`
    prompt += `\n- type 取值：1=问题类型1, 2=问题类型2, 3=问题类型3, 4=问题类型4`
    prompt += `\n- tags 的 variant：pill（普通）、urgent（紧急）、normal（常规）`
    prompt += `\n- shipmentRatio 和 amount 为数字类型，不带引号`
    prompt += `\n- 重要：字段名必须使用 camelCase（materialCode/materialName/partName/partNumber），分类中的问题数组字段名是 problems（不是 cards）`
    prompt += `\n- 根据分析发现的问题生成卡片，例如：发货率低→创建"发货延迟"类卡片，到货率落后发货率→创建"物流运输"类卡片`

    prompt += `\n\n**示例（2个订单各有问题分类和卡片）：**`
    prompt += `\ncreate_analysis_task({ title: "HT202558001等2个订单履约分析", result: { orders: [`
    prompt += `\n  { contractNumber: "HT202558001", customer: "跨境电商运营有限公司", amount: 247.3, shipmentRatio: 96, status: "发货中", statusClass: "green", sales: "刘洋", region: "华东", orderDate: "2025/02/01",`
    prompt += `\n    problemCategories: [{ name: "物流运输延迟", type: 1, problems: [{ materialCode: "MAT-001", materialName: "断路器控制板", partName: "控制单元", partNumber: "CCU-2000-A", tags: [{ label: "待处理", variant: "pill" }, { label: "发货延迟", variant: "urgent" }] }] }], deliveryTables: [] },`
    prompt += `\n  { contractNumber: "HT202530002", customer: "山东钢铁物流有限公司", amount: 390.5, shipmentRatio: 65, status: "发货中", statusClass: "orange", sales: "孙晶", region: "华东", orderDate: "2025/01/05",`
    prompt += `\n    problemCategories: [{ name: "发货进度滞后", type: 2, problems: [{ materialCode: "MAT-002", materialName: "集货箱体", partName: "箱体组件", partNumber: "BOX-500-B", tags: [{ label: "紧急", variant: "urgent" }] }] }], deliveryTables: [] }`
    prompt += `\n] } })`
    prompt += `\n\n调用后系统会自动创建任务并跳转到分析任务页面。如果没有调用此工具或 problemCategories 为空，看板页面将无法展示分析卡片。`
  }
  prompt += `\n- 当用户点击界面「生成待办清单」按钮时，会发送类似"请为以下合同生成待办清单：..."的消息。收到此消息时，必须调用 generate_todos 工具，不要跳过。其他情况下不要自动调用 generate_todos，等待用户手动触发`

  return prompt
}

function normalizeResultForBackend(data: Record<string, unknown>): Record<string, unknown> {
  if (!data.orders || !Array.isArray(data.orders)) return data

  const orders = data.orders.map((order: any) => {
    const o = { ...order }

    // Normalize problemCategories: cards → problems, snake_case → camelCase
    if (Array.isArray(o.problemCategories)) {
      o.problemCategories = o.problemCategories.map((cat: any) => {
        const c = { ...cat }
        // Convert cards → problems
        if (Array.isArray(c.cards) && !Array.isArray(c.problems)) {
          c.problems = c.cards
          delete c.cards
        }
        // Normalize problem fields: snake_case → camelCase
        if (Array.isArray(c.problems)) {
          c.problems = c.problems.map((p: any) => ({
            materialCode: p.materialCode || p.material_code || '',
            materialName: p.materialName || p.material_name || '',
            partName: p.partName || p.part_name || '',
            partNumber: p.partNumber || p.part_number || '',
            tags: Array.isArray(p.tags) ? p.tags : [],
            status: p.status || '待处理',
            ...Object.fromEntries(
              Object.entries(p).filter(([k]) =>
                !['materialCode', 'materialName', 'partName', 'partNumber', 'tags', 'status',
                  'material_code', 'material_name', 'part_name', 'part_number', 'cards'].includes(k)
              )
            ),
          }))
        }
        // Ensure type is a number
        if (typeof c.type === 'string') {
          c.type = parseInt(c.type, 10) || 1
        }
        return c
      })
    }

    // Normalize deliveryTables
    if (Array.isArray(o.deliveryTables)) {
      o.deliveryTables = o.deliveryTables.map((dt: any) => ({
        title: dt.title || '',
        badge: dt.badge || '',
        items: Array.isArray(dt.items) ? dt.items.map((item: any) => ({
          docNo: item.docNo || item.doc_no || '',
          status: item.status || '',
          lineNo: item.lineNo || item.line_no || '',
          sign: item.sign || '',
          qty: item.qty || 0,
        })) : [],
      }))
    }

    return o
  })

  return { ...data, orders }
}

async function saveStructuredResult(analysisId: string, jsonStr: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = normalizeResultForBackend(JSON.parse(jsonStr))
      const res = await fetch(`${BACKEND_API}/analysis/${analysisId}/result`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      if (res.ok) return true
      const body = await res.text().catch(() => '')
      console.error(`[AgentLoop] saveStructuredResult attempt ${attempt + 1} failed (${res.status}):`, body.slice(0, 200))
    } catch (err) {
      console.error(`[AgentLoop] saveStructuredResult attempt ${attempt + 1} error:`, err)
    }
    if (attempt < 1) await new Promise(r => setTimeout(r, 500))
  }
  return false
}

function hasOrdersInResult(result: Record<string, unknown>): boolean {
  const orders = result.orders
  return Array.isArray(orders) && orders.length > 0
}

function buildFallbackResult(
  sessionMessages: Array<{ role: string; content: string }>,
  contractIds: string[],
): { orders: unknown[] } | null {
  // Scan ALL messages (user + tool) for JSON data blocks with order data
  const allContent = sessionMessages
    .filter((m) => m.role === 'user' || m.role === 'tool')
    .map((m) => m.content)
    .join('\n')

  // Find all ```json blocks
  const jsonBlocks: string[] = []
  const regex = /\`\`\`json\s*([\s\S]*?)\`\`\`/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(allContent)) !== null) {
    jsonBlocks.push(m[1].trim())
  }

  console.log(`[AgentLoop] buildFallbackResult: found ${jsonBlocks.length} JSON blocks, ${contractIds.length} contractIds`)

  for (const jsonStr of jsonBlocks) {
    try {
      const data = JSON.parse(jsonStr)
      const orderList = Array.isArray(data) ? data : data.orders || data.data || []
      if (!Array.isArray(orderList) || orderList.length === 0) continue

      const orders = orderList.map((o: any) => ({
        contractNumber: o.id || o.contractNumber || '',
        customer: o.customer || '',
        amount: typeof o.amount === 'number' ? o.amount / 10000 : Number(o.amount || 0) / 10000,
        shipmentRatio: o.shipmentRatio ?? 0,
        status: (o.shipmentRatio ?? 0) >= 95 ? '已发货' : (o.shipmentRatio ?? 0) >= 50 ? '发货中' : '待发货',
        statusClass: (o.shipmentRatio ?? 0) >= 95 ? 'green' : (o.shipmentRatio ?? 0) >= 50 ? 'blue' : 'orange',
        sales: o.salesperson || '',
        region: o.region || '',
        orderDate: o.orderDate || '',
        problemCategories: [] as unknown[],
        deliveryTables: [] as unknown[],
      }))
      console.log(`[AgentLoop] buildFallbackResult: constructed ${orders.length} orders from JSON block`)
      return { orders }
    } catch {
      continue
    }
  }

  console.log('[AgentLoop] buildFallbackResult: no order data found')
  return null
}

async function buildFallbackFromApi(orderIds: string[]): Promise<{ orders: unknown[] } | null> {
  const orderData = await fetchOrderData(orderIds)
  if (!orderData) return null
  try {
    const orderList = JSON.parse(orderData)
    if (!Array.isArray(orderList) || orderList.length === 0) return null
    const orders = orderList.map((o: any) => ({
      contractNumber: o.id || o.contractNumber || '',
      customer: o.customer || '',
      amount: typeof o.amount === 'number' ? o.amount / 10000 : Number(o.amount || 0) / 10000,
      shipmentRatio: o.shipmentRatio ?? 0,
      status: (o.shipmentRatio ?? 0) >= 95 ? '已发货' : (o.shipmentRatio ?? 0) >= 50 ? '发货中' : '待发货',
      statusClass: (o.shipmentRatio ?? 0) >= 95 ? 'green' : (o.shipmentRatio ?? 0) >= 50 ? 'blue' : 'orange',
      sales: o.salesperson || '',
      region: o.region || '',
      orderDate: o.orderDate || '',
      problemCategories: [] as unknown[],
      deliveryTables: [] as unknown[],
    }))
    console.log(`[AgentLoop] buildFallbackFromApi: constructed ${orders.length} orders via API`)
    return { orders }
  } catch {
    return null
  }
}

function extractStructuredJson(content: string): string | null {
  const match = content.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return null
}
