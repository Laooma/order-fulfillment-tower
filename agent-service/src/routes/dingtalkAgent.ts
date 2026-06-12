import { Router } from 'express'
import { chatCompletion } from '../services/llmEngine'
import { getDefaultModel, getProviderForModel } from '../services/llmConfig'
import { loadSkills } from '../services/skillLoader'
import type { Skill } from '../types'

const router = Router()

// ── Config ──

const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3001/api'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// ── Session store (userId → messages[]) with skill tracking ──

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes — sessions auto-expire after inactivity

interface DingTalkSession {
  messages: Array<{ role: string; content: string; toolCalls?: any; tool_call_id?: string }>
  skillId: string | null
  skillName: string | null
  lastActiveAt: number
}

const sessions = new Map<string, DingTalkSession>()

function getOrCreateSession(userId: string): DingTalkSession {
  const existing = sessions.get(userId)
  // Auto-expire stale sessions — each user gets a fresh session after inactivity
  if (existing && Date.now() - existing.lastActiveAt > SESSION_TTL_MS) {
    console.log(`[DingTalkAgent] Session expired for ${userId} (inactive ${Math.round((Date.now() - existing.lastActiveAt) / 60000)}min), creating new one`)
    sessions.delete(userId)
  }
  if (!sessions.has(userId)) {
    sessions.set(userId, { messages: [], skillId: null, skillName: null, lastActiveAt: Date.now() })
  }
  return sessions.get(userId)!
}

function touchSession(userId: string) {
  const s = sessions.get(userId)
  if (s) s.lastActiveAt = Date.now()
}
}

// ── Intent recognition (same algorithm as agentLoop.ts) ──

async function recognizeIntent(message: string, skills: Skill[], modelId: string): Promise<Skill | null> {
  if (skills.length === 0) return null
  if (skills.length === 1) return skills[0]

  // Filter out internal/crafting skills and notification-only skills for DingTalk
  const excludedSkills = new Set([
    'skill-creater', 'hook-creater', 'cron-task-creator', 'test-helper', 'beat',
    'pending-task-email-notifier', 'overdue-task-reminder',  // notification-only
  ])
  const userFacingSkills = skills.filter(s => !excludedSkills.has(s.id))
  if (userFacingSkills.length === 0) return skills[0]
  if (userFacingSkills.length === 1) return userFacingSkills[0]

  const skillList = userFacingSkills.map((s, i) => `${i + 1}. ${s.name} (id: ${s.id}): ${s.description}`).join('\n')
  const provider = getProviderForModel(modelId)
  if (!provider) return userFacingSkills[0]

  try {
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
    const matched = userFacingSkills.find(s => s.id === chosenId)
    if (matched) {
      console.log(`[DingTalkAgent] Intent → skill: ${matched.name} (${matched.id})`)
      return matched
    }
    // Try name match
    const nameMatch = userFacingSkills.find(s => chosenId.includes(s.name) || s.name.includes(chosenId))
    if (nameMatch) {
      console.log(`[DingTalkAgent] Intent → name-matched: ${nameMatch.name}`)
      return nameMatch
    }
    return userFacingSkills[0]
  } catch (err) {
    console.error('[DingTalkAgent] Intent recognition error:', err)
    return userFacingSkills[0]
  }
}

// ── System prompt ──

function buildSystemPrompt(skill?: Skill | null): string {
  const dingtalkRules = `

## 工具使用规则
- **订单号 vs 合同号**: 用户说的"订单号"如 HT202568001，先用 fetch_orders 按 contractNumber 查询对应的合同号（contract_number 字段），再用 fetch_biz_data 查合同详情。
- **fetch_orders 支持参数**: brand, salesperson, shipMethod, receiptStatus, deliveryStatus, isException, customer, contractNumber, pageSize
- **仅当用户明确要求"生成图表"、"可视化"、"看板"、"用图表展示"时**，才调用 show_analysis_result。**不要自动调用它**。
- **调用 create_analysis_task 时**，必须基于已获取的数据填充详细的 problemCategories 数组，每个分类至少包含 name 和 problems。不要留空数组。
- **生成待办清单**用 generate_todos，需先有 taskId。

## 钉钉消息格式规则
- **钉钉不支持 Markdown 表格**，请用分行列表呈现数据：合同SC-2025-001｜安徽铜业｜333万｜发货率31%
- 创建分析任务后，**必须在回复中包含完整的 Web 端链接**供用户点击打开。
- 回复控制在 600 字内，数据超过 8 条提示用户到 Web 端查看完整列表。
- 用户发送 "/new" 或 "/新对话" 时，清空历史开启新对话。
- **回复结尾附上使用的Skill名称**，格式：\`[Skill: {名称}]\`。`

  if (skill) {
    return `## ⚠️ 核心身份（最高优先级，覆盖一切后续描述）
你是「订单履约控制塔」的全能助手。**你不是某个特定Skill的专家，你拥有全部能力。**
下面的"参考Skill"仅表示用户意图被匹配到了该方向，**绝不限制你的工具使用范围**。
当用户要求你做任何事（如收入确认、待办查询、创建任务），直接用正确的工具完成，**禁止说"我没有这个Skill"、"我不具备该能力"之类的话**。

## 参考Skill: ${skill.name}（仅供参考，不限制能力）
${skill.prompt}

## 工具清单（全部可用）
fetch_orders、fetch_biz_data、search_material_stock、get_pending_todos、create_analysis_task、show_analysis_result、generate_todos、mark_task_complete、send_notification、list_notification_channels
${dingtalkRules}

当前时间: ${new Date().toLocaleString('zh-CN')}`
  }

  // Fallback generic prompt (no skill matched)
  return `你是「订单履约控制塔」的智能助手，通过钉钉机器人为用户提供服务。

## 你的能力
- **查询订单**: 调用 fetch_orders 获取订单列表
- **分析合同**: 调用 fetch_biz_data 查询合同物料需求和库存齐套
- **库存搜索**: 调用 search_material_stock 按物料编码查询库存分布
- **待办查询**: 调用 get_pending_todos 获取未完成待办清单
- **创建分析任务**: 调用 create_analysis_task 创建分析任务并返回 Web 端链接
- **可视化**: 调用 show_analysis_result 生成数据看板并返回链接
- **生成待办**: 调用 generate_todos 为分析任务生成执行待办
- **任务验证**: 调用 mark_task_complete 验证并标记任务完成
- **发送通知**: 调用 send_notification 通过通知渠道发送消息
${dingtalkRules}

当前时间: ${new Date().toLocaleString('zh-CN')}`
}

// ═══════════════════════════════════════════
// Tool handlers — calling backend APIs
// ═══════════════════════════════════════════

async function handleFetchOrders(args: Record<string, unknown>): Promise<string> {
  try {
    const params = new URLSearchParams()
    for (const key of ['brand', 'salesperson', 'shipMethod', 'receiptStatus', 'deliveryStatus', 'customer', 'contractNumber']) {
      if (args[key]) params.set(key, String(args[key]))
    }
    if (args.isException !== undefined && args.isException !== null) {
      params.set('isException', String(args.isException))
    }
    params.set('pageSize', String(args.pageSize || 100))
    params.set('page', '1')
    const res = await fetch(`${BACKEND_API}/orders?${params.toString()}`)
    if (!res.ok) return `Error: HTTP ${res.status}`
    const data = await res.json()
    return JSON.stringify((data.data || []).slice(0, 50), null, 2)
  } catch (err: any) { return `Error: ${err.message}` }
}

async function handleFetchBizData(args: Record<string, unknown>): Promise<string> {
  const contractId = args.contractId as string | undefined
  const packageId = args.packageId as string | undefined
  if (!contractId && !packageId) return 'Error: contractId or packageId required'
  try {
    let url = packageId
      ? `${BACKEND_API}/biz-contracts/packages/${encodeURIComponent(packageId)}/kit-check`
      : `${BACKEND_API}/biz-contracts/${encodeURIComponent(contractId!)}/kit-check`
    const res = await fetch(url)
    if (!res.ok) return `Error: HTTP ${res.status}`
    return JSON.stringify(await res.json(), null, 2)
  } catch (err: any) { return `Error: ${err.message}` }
}

async function handleSearchMaterialStock(args: Record<string, unknown>): Promise<string> {
  const code = args.materialCode as string
  if (!code) return 'Error: materialCode required'
  try {
    const res = await fetch(`${BACKEND_API}/biz-contracts/materials/search?code=${encodeURIComponent(code)}`)
    if (!res.ok) return `Error: HTTP ${res.status}`
    return JSON.stringify(await res.json(), null, 2)
  } catch (err: any) { return `Error: ${err.message}` }
}

async function handleGetPendingTodos(args: Record<string, unknown>): Promise<string> {
  try {
    const assignee = args.assignee as string | undefined
    const [tasksRes] = await Promise.all([fetch(`${BACKEND_API}/tasks?pageSize=200`)])
    const execTasks = (await tasksRes.json() as any).data || []
    const pending = execTasks.filter((t: any) => t.status !== 'done')
    const filtered = assignee ? pending.filter((t: any) => t.assignee === assignee) : pending
    const result = {
      total: filtered.length,
      byPriority: {
        high: filtered.filter((t: any) => t.priority === 'high').length,
        medium: filtered.filter((t: any) => t.priority === 'medium').length,
        low: filtered.filter((t: any) => t.priority === 'low').length,
      },
      todos: filtered.slice(0, 20).map((t: any) => ({
        id: t.id, category: t.categoryLabel, description: (t.title || '').slice(0, 80),
        priority: t.priority, assignee: t.assignee, dueDate: t.dueDate, status: t.statusLabel,
      })),
    }
    return JSON.stringify(result, null, 2)
  } catch (err: any) { return `Error: ${err.message}` }
}

async function handleSendNotification(args: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_API}/notifications/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: args.channelId, to: args.to, subject: args.subject, message: args.message,
      }),
    })
    const r = await res.json() as any
    return r.success ? `通知已通过 ${args.channelId} 发送` : `发送失败: ${r.error}`
  } catch (err: any) { return `Error: ${err.message}` }
}

async function handleListNotificationChannels(): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_API}/notification-channels`)
    const r = await res.json() as any
    const channels = r.data || []
    if (!channels.length) return '无已配置的通知渠道'
    return channels.map((c: any) => `- ${c.id}: ${c.name} (${c.type}, ${c.enabled ? '启用' : '禁用'})`).join('\n')
  } catch (err: any) { return `Error: ${err.message}` }
}

// ── create_analysis_task ──

async function handleCreateAnalysisTask(args: Record<string, unknown>): Promise<string> {
  try {
    const title = (args.title as string) || '钉钉分析任务'
    const result = args.result as Record<string, any> | undefined
    const rawOrders = (result?.orders as any[]) || []

    // Normalize orders to match backend's saveAnalysisResult expected format
    const normalizedOrders = rawOrders.map((o: any) => {
      // Normalize problemCategories — each must have name, type, and problems array
      const rawCategories = Array.isArray(o.problemCategories) ? o.problemCategories : []
      const normalizedCategories = rawCategories.map((cat: any, ci: number) => ({
        name: cat.name || cat.category || cat.title || `问题分类${ci + 1}`,
        type: typeof cat.type === 'number' ? cat.type : 0,
        problems: Array.isArray(cat.problems) ? cat.problems.map((p: any) => ({
          materialCode: p.materialCode || p.material_code || '',
          materialName: p.materialName || p.material_name || '',
          partName: p.partName || p.part_name || '',
          partNumber: p.partNumber || p.part_number || '',
          tags: Array.isArray(p.tags) ? p.tags : [],
        })) : [],
      }))

      return {
        contractNumber: o.contractNumber || o.contract_number || '',
        customer: o.customer || '',
        amount: String(o.amount || '0'),
        shipmentRatio: Number(o.shipmentRatio || o.shipment_ratio || o.shipmentratio || 0),
        status: o.status || '正常',
        statusClass: o.statusClass || o.status_class || 'blue',
        sales: o.sales || o.salesperson || '',
        region: o.region || '',
        orderDate: o.orderDate || o.order_date || '',
        problemCategories: normalizedCategories,
        deliveryTables: Array.isArray(o.deliveryTables) ? o.deliveryTables : [],
      }
    })

    // 1. Create the analysis task
    const createRes = await fetch(`${BACKEND_API}/analysis`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        orders: normalizedOrders.map(o => o.contractNumber).filter(Boolean),
        agent: '钉钉AI助手',
        skillId: 'dingtalk',
        skillName: '钉钉智能助手',
      }),
    })
    if (!createRes.ok) return `创建分析任务失败: HTTP ${createRes.status}`
    const task = await createRes.json() as any
    const taskId = task.id

    // 2. Save structured result with normalized data
    const normalizedResult = { ...result, orders: normalizedOrders }
    const saveRes = await fetch(`${BACKEND_API}/analysis/${taskId}/result`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedResult),
    })
    if (!saveRes.ok) {
      console.error('[DingTalkAgent] Save result failed:', await saveRes.text())
    }

    return `✅ 分析任务已创建：${title}
任务ID：${taskId}
👉 ${FRONTEND_URL}/analysis/${taskId}

请点击链接在 Web 端查看完整分析看板。`
  } catch (err: any) { return `创建分析任务失败: ${err.message}` }
}

// ── show_analysis_result ──

async function handleShowAnalysisResult(args: Record<string, unknown>): Promise<string> {
  try {
    const title = (args.title as string) || 'AI分析结果'
    const a2uiMessages = args.a2uiMessages as any[] | undefined
    let taskId = (args.taskId as string) || ''

    // Create task if no taskId provided
    if (!taskId) {
      const createRes = await fetch(`${BACKEND_API}/analysis`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, orders: [], agent: '钉钉AI助手', skillId: 'dingtalk', skillName: '钉钉智能助手' }),
      })
      if (createRes.ok) {
        const task = await createRes.json() as any
        taskId = task.id
      }
    }

    // Save A2UI data
    if (taskId && a2uiMessages) {
      await fetch(`${BACKEND_API}/analysis/${taskId}/result`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a2uiMessages }),
      })
    }

    if (taskId) {
      return `📊 可视化分析「${title}」已生成
👉 ${FRONTEND_URL}/analysis/${taskId}

请点击链接在 Web 端查看完整数据看板。`
    }
    return '可视化已生成，但无法创建分析任务链接。请到 Web 端查看。'
  } catch (err: any) { return `生成可视化失败: ${err.message}` }
}

// ── generate_todos ──

async function handleGenerateTodos(args: Record<string, unknown>): Promise<string> {
  try {
    const taskId = (args.taskId as string) || ''
    if (!taskId) return 'Error: taskId 为必填项，请先创建分析任务。'

    // 1. Fetch full analysis data
    const fullRes = await fetch(`${BACKEND_API}/analysis/${taskId}/full`)
    if (!fullRes.ok) return `获取分析数据失败: HTTP ${fullRes.status}`
    const fullData = await fullRes.json()

    // 2. Call LLM to generate todos (simple single-pass)
    const modelId = getDefaultModel()
    const provider = getProviderForModel(modelId)
    if (!provider) return 'LLM 服务不可用，请稍后重试。'

    const todoPrompt = `基于以下分析数据，为每个问题卡片生成具体的待办执行任务。
分析数据：${JSON.stringify(fullData.orders || fullData, null, 2).slice(0, 4000)}

请输出 JSON 数组格式（不要 markdown 代码块）：
[{"category": "入库任务|发货任务|异常处理|合同确认|生产协调", "description": "具体描述", "priority": "high|medium|low", "assignee": "建议负责人", "dueDate": "建议截止日期 YYYY-MM-DD", "contractNumber": "合同号", "taskType": "manual|decision"}]`

    const todoRes = await chatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: '你是订单履约待办生成助手。只输出 JSON 数组，不要代码块标记。' },
        { role: 'user', content: todoPrompt },
      ],
      temperature: 0.3,
    }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })

    // 3. Parse todos
    let todos: any[] = []
    try {
      const content = todoRes.content || ''
      const jsonStr = content.replace(/```json|```/g, '').trim()
      todos = JSON.parse(jsonStr)
      if (!Array.isArray(todos)) todos = []
    } catch {
      return `生成待办清单时解析失败，请到 Web 端手动生成: ${FRONTEND_URL}/analysis/${taskId}`
    }

    if (todos.length === 0) {
      return '未找到需要生成待办的问题卡片。可能分析数据中无异常项。'
    }

    // 4. Save todos
    await fetch(`${BACKEND_API}/analysis/${taskId}/todos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todos }),
    })

    // 5. Update status
    await fetch(`${BACKEND_API}/analysis/${taskId}/status`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todos_generated' }),
    })

    return `📋 已生成 ${todos.length} 个待办任务
👉 ${FRONTEND_URL}/analysis/${taskId}

请点击链接在 Web 端查看和分配待办任务。`
  } catch (err: any) { return `生成待办失败: ${err.message}` }
}

// ── mark_task_complete ──

async function handleMarkTaskComplete(args: Record<string, unknown>): Promise<string> {
  try {
    const taskId = (args.taskId as string) || ''
    const assigneeNote = (args.assigneeNote as string) || ''
    if (!taskId) return 'Error: taskId 为必填项'

    // 1. Fetch task
    const getRes = await fetch(`${BACKEND_API}/tasks/${taskId}`)
    if (!getRes.ok) return `获取任务失败: ${getRes.statusText}`
    const taskData = await getRes.json() as any

    // 2. Extract material codes from task description
    const taskDesc = taskData.description || taskData.title || ''
    const materialCodeRegex = /\b([A-Z]{2,4}-\d{3,4}[A-Za-z]?|[A-Z]{2}\d{6}|[A-Z]+-\d{2,4}-[A-Za-z]?)\b/g
    const rawMatches: string[] = taskDesc.match(materialCodeRegex) || []
    const materialCodes = [...new Set(rawMatches.filter((c: string) => !/^\d{4}-\d{2}-\d{2}$/.test(c)))]

    // 3. Check live stock for shortages
    const shortages: string[] = []
    for (const code of materialCodes) {
      try {
        const matRes = await fetch(`${BACKEND_API}/biz-contracts/materials/search?code=${encodeURIComponent(code)}`)
        if (matRes.ok) {
          const matData = await matRes.json()
          for (const c of (matData.contracts || [])) {
            if (c.shortageQty > 0) {
              shortages.push(`${code}: 缺口${c.shortageQty} (库存${c.currentStock}/需求${c.requiredQty})`)
            }
          }
        }
      } catch { /* skip */ }
    }

    if (shortages.length > 0) {
      return `❌ 任务验证未通过 — 物料仍有缺口:
${shortages.join('\n')}

任务未标记完成，请先解决物料缺口问题。`
    }

    // 4. Verify via LLM
    const modelId = getDefaultModel()
    const provider = getProviderForModel(modelId)
    let passed = true
    if (provider) {
      const verifyRes = await chatCompletion({
        model: modelId,
        messages: [
          { role: 'system', content: '你是任务完成验证助手。判断该任务是否真正完成。以"已完成"或"未完成"开头回复。' },
          { role: 'user', content: `任务: ${taskDesc}\n备注: ${assigneeNote}\n库存无缺口。请判断是否可标记完成。` },
        ],
        temperature: 0.3,
      }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })
      passed = /^已完成/.test(verifyRes.content || '')
    }

    if (!passed) {
      return `❌ 任务验证未通过 — AI 判定任务尚未满足完成条件。
建议到 Web 端查看详情: ${FRONTEND_URL}/tasks`
    }

    // 5. Mark complete
    const markRes = await fetch(`${BACKEND_API}/tasks/${taskId}/mark-complete`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeNote }),
    })
    const markData = await markRes.json() as any
    if (!markRes.ok || !markData.success) return `标记完成失败: ${markData.error || markRes.statusText}`

    return `✅ 任务「${taskDesc.slice(0, 50)}」已标记完成。
${taskData.analysisTaskId ? `👉 ${FRONTEND_URL}/analysis/${taskData.analysisTaskId}` : ''}`
  } catch (err: any) { return `任务验证失败: ${err.message}` }
}

// ── update_analysis_task ──

async function handleUpdateAnalysisTask(args: Record<string, unknown>): Promise<string> {
  try {
    const result = args.result as Record<string, any> | undefined
    if (!result) return 'Error: result 为必填项'

    // Need taskId from context — extract from result or ask user
    return '更新分析任务功能需要指定 taskId。请提供分析任务 ID。'
  } catch (err: any) { return `更新失败: ${err.message}` }
}

// ═══════════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════════

const TOOLS = [
  { type: 'function' as const, function: { name: 'fetch_orders', description: '获取销售订单列表。支持按合同号(contractNumber)、品牌、销售员、客户等筛选。返回订单数组含 id/contractNumber(合同号)/customer/brand/salesperson/orderDate/amount/receiptRatio/shipmentRatio/isException 等字段。用户说的"订单号"如HT202568001通常是订单ID，对应返回中的id字段，contractNumber是合同号。', parameters: { type: 'object', properties: { contractNumber: { type: 'string', description: '合同号筛选' }, brand: { type: 'string' }, salesperson: { type: 'string' }, shipMethod: { type: 'string' }, receiptStatus: { type: 'string' }, deliveryStatus: { type: 'string' }, isException: { type: 'boolean' }, customer: { type: 'string' }, pageSize: { type: 'number' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'fetch_biz_data', description: '获取业务合同/装置/包/物料的层级数据及齐套分析结果。按合同ID或包ID查询。', parameters: { type: 'object', properties: { contractId: { type: 'string' }, packageId: { type: 'string' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'search_material_stock', description: '按物料编码搜索所有合同中的库存分布。返回每个合同的可用库存、在途量、富余量。', parameters: { type: 'object', properties: { materialCode: { type: 'string' } }, required: ['materialCode'] } } },
  { type: 'function' as const, function: { name: 'get_pending_todos', description: '获取未完成待办任务清单，按优先级分组。可按负责人筛选。', parameters: { type: 'object', properties: { assignee: { type: 'string' } }, required: [] } } },
  { type: 'function' as const, function: { name: 'create_analysis_task', description: '创建分析任务并返回 Web 端链接。调用后必须将返回的链接展示给用户。需要 result.orders 数组（含 contractNumber 等字段）或先调用 fetch_orders 获取订单。', parameters: { type: 'object', properties: { title: { type: 'string', description: '分析任务标题' }, result: { type: 'object', description: '分析结果 JSON，含 orders 数组（每个 order 需 contractNumber/customer/amount/shipmentRatio/status/sales/region/orderDate/problemCategories 等字段）' } }, required: ['title', 'result'] } } },
  { type: 'function' as const, function: { name: 'show_analysis_result', description: '生成 A2UI 可视化看板并返回 Web 端链接。调用后必须将返回的链接展示给用户。', parameters: { type: 'object', properties: { title: { type: 'string' }, a2uiMessages: { type: 'array', items: { type: 'object' }, description: 'A2UI v0.9 格式 UI 消息数组' }, taskId: { type: 'string', description: '可选，已有分析任务 ID' } }, required: ['title', 'a2uiMessages'] } } },
  { type: 'function' as const, function: { name: 'generate_todos', description: '为分析任务生成待办执行清单。需先有分析任务（taskId）。返回 Web 端链接。', parameters: { type: 'object', properties: { taskId: { type: 'string', description: '分析任务 ID' } }, required: ['taskId'] } } },
  { type: 'function' as const, function: { name: 'mark_task_complete', description: '验证并标记执行任务为已完成。会检查实时库存数据确认任务是否真正完成。', parameters: { type: 'object', properties: { taskId: { type: 'string' }, assigneeNote: { type: 'string' } }, required: ['taskId'] } } },
  { type: 'function' as const, function: { name: 'update_analysis_task', description: '更新已有分析任务的结构化数据。需要 taskId。', parameters: { type: 'object', properties: { taskId: { type: 'string' }, result: { type: 'object' } }, required: ['taskId', 'result'] } } },
  { type: 'function' as const, function: { name: 'send_notification', description: '通过通知渠道发送消息。需先调用 list_notification_channels 查看可用渠道。', parameters: { type: 'object', properties: { channelId: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' } }, required: ['channelId', 'message'] } } },
  { type: 'function' as const, function: { name: 'list_notification_channels', description: '列出所有已配置的通知渠道。', parameters: { type: 'object', properties: {}, required: [] } } },
]

// ═══════════════════════════════════════════
// Tool dispatcher
// ═══════════════════════════════════════════

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  const n = name.toLowerCase().replace(/_/g, '')
  if (n === 'fetchorders') return handleFetchOrders(args)
  if (n === 'fetchbizdata') return handleFetchBizData(args)
  if (n === 'searchmaterialstock') return handleSearchMaterialStock(args)
  if (n === 'getpendingtodos') return handleGetPendingTodos(args)
  if (n === 'createanalysistask') return handleCreateAnalysisTask(args)
  if (n === 'showanalysisresult') return handleShowAnalysisResult(args)
  if (n === 'generatetodos') return handleGenerateTodos(args)
  if (n === 'marktaskcomplete') return handleMarkTaskComplete(args)
  if (n === 'updateanalysistask') return handleUpdateAnalysisTask(args)
  if (n === 'sendnotification') return handleSendNotification(args)
  if (n === 'listnotificationchannels') return handleListNotificationChannels()
  return `Unknown tool: ${name}`
}

// ── Subagent helpers ──

interface Subagent {
  id: string
  name: string
  description: string
  system_prompt: string
  icon: string
  color: string
}

async function fetchSubagent(subagentId: string): Promise<Subagent | null> {
  try {
    const res = await fetch(`${BACKEND_API}/subagents/${subagentId}`)
    if (!res.ok) return null
    return await res.json() as Subagent
  } catch { return null }
}

function buildSubagentPrompt(subagent: Subagent): string {
  const dingtalkRules = `
## 钉钉消息格式规则
- **钉钉不支持 Markdown 表格**，请用分行列表呈现数据
- 创建分析任务后，**必须在回复中包含完整的 Web 端链接**供用户点击打开。
- 回复控制在 600 字内，数据超过 8 条提示用户到 Web 端查看完整列表。
- 用户发送 "/new" 或 "/新对话" 时，清空历史开启新对话。
- **回复结尾附上使用的Subagent名称**，格式：\`[Subagent: {名称}]\`。`

  return `你是「订单履约控制塔」的「${subagent.name}」。
${subagent.system_prompt}

## 可用工具
fetch_orders、fetch_biz_data、search_material_stock、get_pending_todos、create_analysis_task、show_analysis_result、generate_todos、mark_task_complete、send_notification、list_notification_channels
${dingtalkRules}

当前时间: ${new Date().toLocaleString('zh-CN')}`
}

// ═══════════════════════════════════════════
// POST /api/dingtalk-agent
// ═══════════════════════════════════════════

router.post('/dingtalk-agent', async (req, res) => {
  const { message, userId, subagentId } = req.body
  if (!message) {
    res.status(400).json({ error: 'message is required' })
    return
  }

  const uid = userId || 'anonymous'
  console.log(`[DingTalkAgent] userId=${uid} subagent=${subagentId || 'none'} msg=${message.slice(0, 80)}`)

  // Handle /new command — clear session including skill assignment
  if (message.trim() === '/new' || message.trim() === '/新对话') {
    sessions.delete(uid)
    console.log(`[DingTalkAgent] Session cleared for ${uid}`)
    res.json({ content: '✅ 已开启新对话。有什么可以帮您？' })
    return
  }

  const modelId = getDefaultModel()
  const provider = getProviderForModel(modelId)
  if (!provider) {
    res.status(500).json({ error: 'No LLM provider configured' })
    return
  }

  const session = getOrCreateSession(uid)
  const { messages } = session

  // First message: build system prompt
  if (messages.length === 0) {
    let systemPrompt: string

    if (subagentId) {
      // Subagent mode: fetch subagent from backend, use its prompt directly
      const subagent = await fetchSubagent(subagentId)
      if (subagent) {
        session.skillName = subagent.name
        systemPrompt = buildSubagentPrompt(subagent)
        console.log(`[DingTalkAgent] Using subagent: ${subagent.name}`)
      } else {
        systemPrompt = buildSystemPrompt(null)
      }
    } else {
      // Default mode: intent recognition + skill matching
      const skills = loadSkills()
      const skill = await recognizeIntent(message, skills, modelId)
      if (skill) {
        session.skillId = skill.id
        session.skillName = skill.name
      }
      systemPrompt = buildSystemPrompt(skill)
    }
    messages.push({ role: 'system', content: systemPrompt })
  }

  messages.push({ role: 'user', content: message })

  let finalContent = ''
  const MAX_ITERS = 10

  try {
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      const response = await chatCompletion({
        model: modelId,
        messages: messages.map((m) => {
          const base: any = { role: m.role, content: m.content }
          if (m.role === 'assistant' && m.toolCalls) base.tool_calls = m.toolCalls
          if (m.role === 'tool' && m.tool_call_id) base.tool_call_id = m.tool_call_id
          return base
        }),
        temperature: 0.7,
        tools: TOOLS,
      }, { apiKey: provider.apiKey, apiUrl: provider.apiUrl })

      if (response.content) {
        finalContent = response.content
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content || '' })
        break
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      })

      for (const tc of response.toolCalls) {
        const toolName = tc.function?.name || ''
        let toolArgs: Record<string, unknown> = {}
        try { toolArgs = JSON.parse(tc.function?.arguments || '{}') } catch {}

        console.log(`[DingTalkAgent] Tool: ${toolName}`, JSON.stringify(toolArgs).slice(0, 150))
        const toolResult = await dispatchTool(toolName, toolArgs)

        messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: tc.id,
        })
      }
    }

    // Cleanup old sessions (keep last 500)
    if (sessions.size > 500) {
      const keys = [...sessions.keys()]
      for (const key of keys.slice(0, 100)) sessions.delete(key)
    }

    touchSession(uid)
    console.log(`[DingTalkAgent] Response: ${finalContent.slice(0, 100)}`)
    res.json({ content: finalContent || '抱歉，我没有理解您的问题，请换个方式描述。' })
  } catch (err: any) {
    console.error('[DingTalkAgent] Error:', err.message)
    // Remove the user message that caused the error so session can continue
    messages.pop()
    res.status(500).json({ error: err.message })
  }
})

export default router
