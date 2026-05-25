import { Router } from 'express'
import { getDb } from '../services/database'
import { mockTasks } from '../services/mockData'
import { applyDataScope, type CurrentUser } from '../middleware/auth'

const router = Router()

const typeLabels: Record<string, string> = {
  agent: 'Agent任务',
  decision: '决策任务',
  manual: '手工任务',
}

const priorityLabels: Record<string, string> = {
  high: '高',
  mid: '中',
  low: '低',
}

const statusLabels: Record<string, string> = {
  pending: '待开始',
  progress: '进行中',
  overdue: '逾期',
  done: '已完成',
}

// Reverse map: Chinese category label → short code
const categoryReverseMap: Record<string, string> = {
  '发货任务': 'ship',
  '入库任务': 'inbound',
  '合同确认': 'contract',
  '异常处理': 'exception',
  '补发任务': 'ship',
  '分批发货': 'ship',
  '物流跟踪': 'ship',
  '物流任务': 'ship',
  '物流跟进': 'ship',
  '海外物流': 'ship',
  '尾单攻坚': 'ship',
  '交付保障': 'ship',
  '签收跟进': 'ship',
  '签收任务': 'ship',
  '回单任务': 'ship',
  '收货确认': 'inbound',
  '到货跟进': 'inbound',
  '物料排查': 'inbound',
  '供应排查': 'contract',
  '供应链溯源': 'contract',
  '收入确认任务': 'contract',
  '系统维护': 'exception',
  '系统修复': 'exception',
  '异常排查': 'exception',
  '异常标记': 'exception',
  '风险预警': 'exception',
  '升级处理': 'exception',
  '紧急升级': 'exception',
  '客户沟通': 'exception',
  '客户紧急沟通': 'exception',
  '客户关系维护': 'exception',
  '测试任务': 'ship',
}

function mapCategory(cat: string | undefined | null): { code: string; label: string } {
  const label = cat || '发货任务'
  const code = categoryReverseMap[label] || 'ship'
  return { code, label }
}

function mapPriority(p: string): string {
  if (p === 'medium') return 'mid'
  return p
}

function mapRow(r: any) {
  const priority = mapPriority(r.priority || 'mid')
  const cat = mapCategory(r.category)
  return {
    id: r.id,
    contractId: r.contract_number || '',
    type: r.task_type || 'manual',
    typeLabel: typeLabels[r.task_type] || '手工任务',
    title: (r.description || '').slice(0, 50),
    description: r.description || '',
    priority,
    priorityLabel: priorityLabels[priority] || '中',
    assignee: r.assignee || '',
    supervisor: r.supervisor || '',
    dueDate: r.due_date || '',
    status: r.status || 'pending',
    statusLabel: statusLabels[r.status] || '待开始',
    category: cat.code,
    categoryLabel: cat.label,
    skillId: r.skill_id || '',
    skillName: r.skill_name || '',
  }
}

// GET /api/tasks?type=&status=&category=&assignee=&priority=&search=&page=&pageSize=
router.get('/', (req, res) => {
  try {
    const db = getDb()
    let where = 'WHERE 1=1'
    const params: any[] = []

    const { type, status, category, assignee, priority, search } = req.query

    if (type && typeof type === 'string' && type !== 'all') {
      where += ' AND at2.task_type = ?'
      params.push(type)
    }
    if (status && typeof status === 'string' && status !== 'all') {
      where += ' AND at2.status = ?'
      params.push(status)
    }
    if (category && typeof category === 'string' && category !== 'all') {
      const dbCats = Object.entries(categoryReverseMap)
        .filter(([, code]) => code === category)
        .map(([label]) => label)
      if (dbCats.length > 0) {
        where += ` AND at2.category IN (${dbCats.map(() => '?').join(',')})`
        params.push(...dbCats)
      } else {
        where += ' AND at2.category = ?'
        params.push(category)
      }
    }
    if (assignee && typeof assignee === 'string' && assignee !== 'all') {
      where += ' AND at2.assignee = ?'
      params.push(assignee)
    }
    if (priority && typeof priority === 'string' && priority !== 'all') {
      const p = priority === 'mid' ? 'medium' : priority
      where += ' AND at2.priority = ?'
      params.push(p)
    }
    if (search && typeof search === 'string') {
      const q = `%${search.toLowerCase()}%`
      where += ' AND (LOWER(at2.description) LIKE ? OR LOWER(ao.contract_number) LIKE ? OR LOWER(at2.assignee) LIKE ?)'
      params.push(q, q, q)
    }

    // Apply data scope from RBAC
    const user = (req as any).currentUser as CurrentUser | undefined
    if (user) {
      const scope = applyDataScope(user, 'todos')
      if (scope.sql) {
        where += scope.sql
        params.push(...scope.params)
      }
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM analysis_todos at2
       JOIN analysis_orders ao ON at2.order_id = ao.id
       ${where}`
    ).get(...params) as any
    const total = countRow?.total || 0

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1)
    const pageSize = Math.max(1, parseInt(req.query.pageSize as string, 10) || 20)
    const offset = (page - 1) * pageSize

    const rows = db.prepare(
      `SELECT at2.*, ao.contract_number
       FROM analysis_todos at2
       JOIN analysis_orders ao ON at2.order_id = ao.id
       ${where}
       ORDER BY at2.priority = 'high' DESC, at2.status = 'overdue' DESC, at2.due_date ASC
       LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset) as any[]

    const data = rows.map(mapRow)
    res.json({ data, total, page, pageSize })
  } catch (err) {
    console.error('[Tasks] DB query error:', err)
    // Fallback to mock data
    let data = [...mockTasks]
    const { type, status, category, assignee, priority, search } = req.query
    if (type && typeof type === 'string' && type !== 'all') data = data.filter((t: any) => t.type === type)
    if (status && typeof status === 'string' && status !== 'all') data = data.filter((t: any) => t.status === status)
    if (category && typeof category === 'string' && category !== 'all') data = data.filter((t: any) => t.category === category)
    if (assignee && typeof assignee === 'string' && assignee !== 'all') data = data.filter((t: any) => t.assignee === assignee)
    if (priority && typeof priority === 'string' && priority !== 'all') data = data.filter((t: any) => t.priority === priority)
    if (search && typeof search === 'string') {
      const q = search.toLowerCase()
      data = data.filter((t: any) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.contractId.toLowerCase().includes(q)
      )
    }
    const total = data.length
    const p = Math.max(1, parseInt(req.query.page as string, 10) || 1)
    const ps = Math.max(1, parseInt(req.query.pageSize as string, 10) || 20)
    const pageData = data.slice((p - 1) * ps, p * ps)
    res.json({ data: pageData, total, page: p, pageSize: ps })
  }
})

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const row = db.prepare(
      `SELECT at2.*, ao.contract_number
       FROM analysis_todos at2
       JOIN analysis_orders ao ON at2.order_id = ao.id
       WHERE at2.id = ?`
    ).get(req.params.id) as any

    if (!row) {
      const task = mockTasks.find((t: any) => t.id === req.params.id)
      if (!task) { res.status(404).json({ error: 'Task not found' }); return }
      res.json(task)
      return
    }
    res.json(mapRow(row))
  } catch (err) {
    console.error('[Tasks] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

export default router
