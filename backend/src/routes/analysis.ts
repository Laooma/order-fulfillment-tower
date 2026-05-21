import { Router } from 'express'
import { mockAnalysisTasks } from '../services/mockData'
import { getDb, getAnalysisFull, saveAnalysisResult, getCardDetail, saveCardDetail, updateTaskStatus, getTaskStatus } from '../services/database'
import { requireOperation } from '../middleware/auth'

const router = Router()

// GET /api/analysis?taskId=&status=&page=&pageSize=&sortCol=&sortDir=
router.get('/', (req, res) => {
  const {
    taskId,
    status,
    page = '1',
    pageSize = '10',
    sortCol,
    sortDir = 'desc',
  } = req.query

  try {
    const db = getDb()
    let where = 'WHERE 1=1'
    const params: any[] = []

    if (taskId && typeof taskId === 'string') {
      where += ' AND id LIKE ?'
      params.push(`%${taskId}%`)
    }
    if (status && typeof status === 'string') {
      where += ' AND status = ?'
      params.push(status)
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM analysis_tasks ${where}`).get(...params) as any
    const total = countRow?.total || 0

    const p = Math.max(1, parseInt(page as string, 10))
    const ps = Math.max(1, parseInt(pageSize as string, 10))
    const offset = (p - 1) * ps

    let orderBy = 'ORDER BY created_at DESC'
    if (sortCol && typeof sortCol === 'string') {
      const col = sortCol === 'createdAt' ? 'created_at' :
                  sortCol === 'completedAt' ? 'completed_at' :
                  sortCol === 'relatedContracts' ? 'created_at' : sortCol
      const dir = sortDir === 'asc' ? 'ASC' : 'DESC'
      orderBy = `ORDER BY ${col} ${dir}`
    }

    const rows = db.prepare(
      `SELECT id, title, description, agent, initiator, status, created_at, completed_at
       FROM analysis_tasks ${where} ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, ps, offset) as any[]

    // Convert to frontend format
    const data = rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      agent: r.agent,
      initiator: r.initiator,
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      // For list compatibility, fetch related contract numbers
      relatedContracts: getRelatedContracts(db, r.id),
    }))

    res.json({ data, total, page: p, pageSize: ps })
  } catch (err) {
    console.error('[Analysis] List error:', err)
    // Fallback to mock data
    let data = [...mockAnalysisTasks]
    if (taskId && typeof taskId === 'string') {
      data = data.filter((t) => t.id.toLowerCase().includes(taskId.toLowerCase()))
    }
    if (status && typeof status === 'string') {
      data = data.filter((t) => t.status === status)
    }
    const total = data.length
    const p = Math.max(1, parseInt(page as string, 10))
    const ps = Math.max(1, parseInt(pageSize as string, 10))
    const pageData = data.slice((p - 1) * ps, p * ps)
    res.json({ data: pageData, total, page: p, pageSize: ps })
  }
})

function getRelatedContracts(db: any, taskId: string): string[] {
  try {
    const orders = db.prepare('SELECT contract_number FROM analysis_orders WHERE analysis_task_id = ?').all(taskId) as any[]
    return orders.map((o: any) => o.contract_number)
  } catch {
    return []
  }
}

// GET /api/analysis/:id - single task
router.get('/:id', (req, res) => {
  try {
    const db = getDb()
    const row = db.prepare(
      'SELECT id, title, description, agent, initiator, status, created_at, completed_at FROM analysis_tasks WHERE id = ?'
    ).get(req.params.id) as any

    if (!row) {
      // Fallback to mock
      const task = mockAnalysisTasks.find((t) => t.id === req.params.id)
      if (!task) { res.status(404).json({ error: 'Analysis task not found' }); return }
      res.json(task)
      return
    }

    res.json({
      id: row.id,
      title: row.title,
      description: row.description,
      agent: row.agent,
      initiator: row.initiator,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      relatedContracts: getRelatedContracts(db, row.id),
    })
  } catch (err) {
    console.error('[Analysis] Get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/analysis/:id/full - full analysis result with orders, categories, problems, todos
router.get('/:id/full', (req, res) => {
  try {
    const result = getAnalysisFull(req.params.id)
    if (!result) {
      res.status(404).json({ error: 'Analysis task not found' })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('[Analysis] Full error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/analysis/:id/card/:problemId - single card detail
router.get('/:id/card/:problemId', (req, res) => {
  try {
    const detail = getCardDetail(req.params.id, req.params.problemId)
    if (!detail) {
      res.status(404).json({ error: 'Card not found' })
      return
    }
    res.json(detail)
  } catch (err) {
    console.error('[Analysis] Card detail error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/analysis/:id/card/:problemId - save card detail
router.put('/:id/card/:problemId', (req, res) => {
  try {
    const result = saveCardDetail(req.params.problemId, req.body)
    res.json(result)
  } catch (err: any) {
    console.error('[Analysis] Save card detail error:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/analysis - create task
router.post('/', requireOperation('create_analysis'), (req, res) => {
  const { title, orders, agent } = req.body
  const id = `T${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`

  try {
    const db = getDb()
    db.prepare(`
      INSERT INTO analysis_tasks (id, title, description, agent, initiator, status, created_at, completed_at)
      VALUES (?, ?, ?, ?, '系统', 'analyzing', ?, '')
    `).run(id, title || '新分析任务', `分析 ${orders?.length || 0} 个订单的履约状态`, agent || 'AI智能体', new Date().toLocaleString('zh-CN'))
  } catch (err) {
    console.error('[Analysis] Create error:', err)
  }

  // Also add to mock for compatibility
  const newTask = {
    id,
    title: title || '新分析任务',
    taskType: 'agent任务',
    description: `分析 ${orders?.length || 0} 个订单的履约状态`,
    agent: agent || 'AI智能体',
    initiator: 'Hi·金星米',
    status: 'analyzing',
    createdAt: new Date().toLocaleString('zh-CN'),
    completedAt: '',
    relatedContracts: orders || [],
  }
  mockAnalysisTasks.unshift(newTask)

  res.status(201).json(newTask)
})

// PUT /api/analysis/:id/result - save structured AI analysis result to DB
router.put('/:id/result', (req, res) => {
  try {
    const result = saveAnalysisResult(req.params.id, req.body)
    // Update task status to analyzed (kanban ready, todos not yet generated)
    updateTaskStatus(req.params.id, 'analyzed')
    res.json(result)
  } catch (err: any) {
    console.error('[Analysis] Save result error:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/analysis/:id/status
router.get('/:id/status', (req, res) => {
  const status = getTaskStatus(req.params.id)
  if (!status) {
    res.status(404).json({ error: 'Analysis task not found' })
    return
  }
  res.json({ status })
})

// PUT /api/analysis/:id/status
router.put('/:id/status', (req, res) => {
  const { status } = req.body
  if (!status || !['analyzing', 'analyzed', 'todos_generated', 'completed'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }
  const ok = updateTaskStatus(req.params.id, status)
  if (!ok) {
    res.status(404).json({ error: 'Analysis task not found' })
    return
  }
  res.json({ success: true })
})

// GET /api/analysis/:id/todos
router.get('/:id/todos', (req, res) => {
  try {
    const db = getDb()
    const todos = db.prepare(`
      SELECT at2.* FROM analysis_todos at2
      JOIN analysis_orders ao ON at2.order_id = ao.id
      WHERE ao.analysis_task_id = ?
    `).all(req.params.id) as any[]

    res.json({
      data: todos.map((t: any) => ({
        id: t.id,
        category: t.category,
        description: t.description,
        priority: t.priority,
        assignee: t.assignee,
        dueDate: t.due_date,
        status: t.status,
        taskType: t.task_type,
      })),
    })
  } catch (err) {
    // Fallback to mock
    const task = mockAnalysisTasks.find((t) => t.id === req.params.id)
    if (!task) { res.status(404).json({ error: 'Analysis task not found' }); return }
    const { mockTasks } = require('../services/mockData')
    const todos = mockTasks.filter((t: any) => task.relatedContracts.includes(t.contractId))
    res.json({ data: todos })
  }
})

// POST /api/analysis/:id/todos - save generated todos
router.post('/:id/todos', (req, res) => {
  try {
    const { todos } = req.body
    if (!Array.isArray(todos)) {
      res.status(400).json({ error: 'todos array is required' })
      return
    }
    const db = getDb()

    const insertTodo = db.prepare(`
      INSERT OR REPLACE INTO analysis_todos (id, order_id, category, description, priority, assignee, due_date, status, task_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const getOrder = db.prepare(`
      SELECT id FROM analysis_orders WHERE analysis_task_id = ? AND contract_number = ?
    `)

    let count = 0
    for (const todo of todos) {
      const order = getOrder.get(req.params.id, todo.contractNumber) as any
      if (!order) continue
      const todoId = `${order.id}_todo_gen_${count}`
      insertTodo.run(
        todoId, order.id,
        todo.category || '发货任务',
        todo.description || '',
        todo.priority || 'medium',
        todo.assignee || '',
        todo.dueDate || '',
        todo.status || 'pending',
        todo.taskType || 'manual'
      )
      count++
    }

    res.json({ success: true, count })
  } catch (err: any) {
    console.error('[Analysis] Save todos error:', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
