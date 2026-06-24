import { Router } from 'express'
import {
  getExecutionTask,
  listExecutionTasks,
  createExecutionTask,
  updateExecutionTask,
  deleteExecutionTask,
  createExecutionStep,
  updateExecutionStep,
  listExecutionSteps,
  createDecisionOption,
  getDecisionOptions,
  selectDecisionOption,
  createTaskHandover,
  getTaskHandovers,
  migrateTodosToExecutionTasks,
} from '../services/database'

const router = Router()

const statusLabels: Record<string, string> = {
  pending: '待开始',
  progress: '进行中',
  overdue: '逾期',
  done: '已完成',
}

const priorityLabels: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const categoryLabels: Record<string, string> = {
  ship: '发货任务',
  inbound: '入库任务',
  contract: '合同确认',
  exception: '异常处理',
}

function enrichTask(task: any) {
  if (!task) return task
  return {
    ...task,
    statusLabel: statusLabels[task.status] || task.status,
    priorityLabel: priorityLabels[task.priority] || task.priority,
    categoryLabel: categoryLabels[task.category] || task.category,
    steps: task.steps?.map((s: any) => ({
      ...s,
      statusLabel: statusLabels[s.status] || s.status,
      typeLabel: s.step_type === 'agent' ? 'Agent' : s.step_type === 'decision' ? '决策' : '手工',
    })),
  }
}

// GET /api/execution-tasks
router.get('/', (req, res) => {
  try {
    const result = listExecutionTasks({
      status: req.query.status as string,
      category: req.query.category as string,
      assignee: req.query.assignee as string,
      supervisor: req.query.supervisor as string,
      priority: req.query.priority as string,
      search: req.query.search as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined,
    })
    res.json({ ...result, data: result.data.map(enrichTask) })
  } catch (err) {
    console.error('[ExecutionTasks] list error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/execution-tasks
router.post('/', (req, res) => {
  try {
    const task = createExecutionTask(req.body)
    res.json({ success: true, data: enrichTask(task) })
  } catch (err) {
    console.error('[ExecutionTasks] create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/execution-tasks/migrate
router.post('/migrate', (req, res) => {
  try {
    const result = migrateTodosToExecutionTasks()
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[ExecutionTasks] migrate error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/execution-tasks/:id
router.get('/:id', (req, res) => {
  try {
    const task = getExecutionTask(req.params.id)
    if (!task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.json(enrichTask(task))
  } catch (err) {
    console.error('[ExecutionTasks] get error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/execution-tasks/:id
router.put('/:id', (req, res) => {
  try {
    const task = updateExecutionTask(req.params.id, req.body)
    if (!task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.json({ success: true, data: enrichTask(task) })
  } catch (err) {
    console.error('[ExecutionTasks] update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// DELETE /api/execution-tasks/:id
router.delete('/:id', (req, res) => {
  try {
    const result = deleteExecutionTask(req.params.id)
    res.json(result)
  } catch (err) {
    console.error('[ExecutionTasks] delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/execution-tasks/:id/steps
router.get('/:id/steps', (req, res) => {
  try {
    const steps = listExecutionSteps(req.params.id)
    res.json({ data: steps })
  } catch (err) {
    console.error('[ExecutionTasks] list steps error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/execution-tasks/:id/steps
router.post('/:id/steps', (req, res) => {
  try {
    const step = createExecutionStep({ ...req.body, executionTaskId: req.params.id })
    res.json({ success: true, data: step })
  } catch (err) {
    console.error('[ExecutionTasks] create step error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/execution-steps/:id
router.put('/steps/:id', (req, res) => {
  try {
    const step = updateExecutionStep(req.params.id, req.body)
    if (!step) {
      res.status(404).json({ error: 'Step not found' })
      return
    }
    res.json({ success: true, data: step })
  } catch (err) {
    console.error('[ExecutionTasks] update step error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/execution-steps/:id/complete
router.put('/steps/:id/complete', (req, res) => {
  try {
    const now = new Date().toLocaleString('zh-CN')
    const step = updateExecutionStep(req.params.id, {
      status: 'done',
      completedAt: now,
      resultData: req.body.resultData || {},
    })
    if (!step) {
      res.status(404).json({ error: 'Step not found' })
      return
    }

    // Load parent task for auto-advance logic
    const task = getExecutionTask(step.execution_task_id)
    if (task) {
      const allSteps = (task.steps || []).sort((a: any, b: any) => a.step_order - b.step_order)

      // Auto-complete subsequent steps that have the same assignee as the task
      const currentIdx = allSteps.findIndex((s: any) => s.id === step.id)
      if (currentIdx >= 0) {
        for (let i = currentIdx + 1; i < allSteps.length; i++) {
          const nextStep = allSteps[i]
          if (nextStep.status === 'done') continue
          if (nextStep.assignee && nextStep.assignee === task.assignee) {
            updateExecutionStep(nextStep.id, {
              status: 'done',
              completedAt: now,
              resultData: { autoCompleted: true, reason: '执行人与任务待办人相同，自动完成' },
            })
          } else {
            break // Stop at the first step with a different assignee
          }
        }
      }

      // Update task status if all steps are done
      const updatedTask = getExecutionTask(task.id)
      const remainingSteps = (updatedTask.steps || []).filter((s: any) => s.status !== 'done')
      if (remainingSteps.length === 0) {
        updateExecutionTask(task.id, { status: 'done' })
      }

      // Return enriched task with updated steps
      const finalTask = getExecutionTask(task.id)
      res.json({ success: true, data: enrichTask(finalTask) })
      return
    }

    res.json({ success: true, data: step })
  } catch (err) {
    console.error('[ExecutionTasks] complete step error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/execution-steps/:id/execute — run agent step
router.put('/steps/:id/execute', (req, res) => {
  try {
    const now = new Date().toLocaleString('zh-CN')
    const step = updateExecutionStep(req.params.id, {
      status: 'progress',
      startedAt: now,
      handler: req.body.handler || 'Agent',
    })
    if (!step) {
      res.status(404).json({ error: 'Step not found' })
      return
    }
    res.json({ success: true, data: step })
  } catch (err) {
    console.error('[ExecutionTasks] execute step error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/execution-steps/:id/options
router.get('/steps/:id/options', (req, res) => {
  try {
    const options = getDecisionOptions(req.params.id)
    res.json({ data: options })
  } catch (err) {
    console.error('[ExecutionTasks] list options error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /api/execution-steps/:id/options
router.post('/steps/:id/options', (req, res) => {
  try {
    const options = createDecisionOption({ ...req.body, stepId: req.params.id })
    res.json({ success: true, data: options })
  } catch (err) {
    console.error('[ExecutionTasks] create option error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/execution-steps/:stepId/decide
// complete=false (default): save decision only, don't mark step done — used for submission then verify flow
// complete=true: legacy behaviour — mark step done immediately + auto-advance (called by mark_task_complete tool)
router.put('/steps/:stepId/decide', (req, res) => {
  try {
    const { optionId, comment, handler, resultData, complete } = req.body
    selectDecisionOption(req.params.stepId, optionId)
    const now = new Date().toLocaleString('zh-CN')

    if (!complete) {
      // ── Submit mode: save decision, keep step status unchanged ──
      const step = updateExecutionStep(req.params.stepId, {
        handler: handler || '',
        resultData: { decisionOptionId: optionId, comment, submitted: true, ...(resultData || {}) },
      })
      if (!step) {
        res.status(404).json({ error: 'Step not found' })
        return
      }
      res.json({ success: true, submitted: true, data: step })
      return
    }

    // ── Complete mode: mark step done + auto-advance ──
    const step = updateExecutionStep(req.params.stepId, {
      status: 'done',
      completedAt: now,
      handler: handler || '',
      resultData: { decisionOptionId: optionId, comment, ...(resultData || {}) },
    })
    if (!step) {
      res.status(404).json({ error: 'Step not found' })
      return
    }

    // Load parent task for auto-advance logic
    const task = getExecutionTask(step.execution_task_id)
    if (task) {
      const allSteps = (task.steps || []).sort((a: any, b: any) => a.step_order - b.step_order)

      // Auto-complete subsequent steps that have the same assignee as the task
      const currentIdx = allSteps.findIndex((s: any) => s.id === step.id)
      if (currentIdx >= 0) {
        for (let i = currentIdx + 1; i < allSteps.length; i++) {
          const nextStep = allSteps[i]
          if (nextStep.status === 'done') continue
          if (nextStep.assignee && nextStep.assignee === task.assignee) {
            updateExecutionStep(nextStep.id, {
              status: 'done',
              completedAt: now,
              resultData: { autoCompleted: true, reason: '执行人与任务待办人相同，自动完成' },
            })
          } else {
            break
          }
        }
      }

      // Update task status if all steps are done
      const updatedTask = getExecutionTask(task.id)
      const remainingSteps = (updatedTask.steps || []).filter((s: any) => s.status !== 'done')
      if (remainingSteps.length === 0) {
        updateExecutionTask(task.id, { status: 'done' })
      }

      const finalTask = getExecutionTask(task.id)
      res.json({ success: true, data: enrichTask(finalTask) })
      return
    }

    res.json({ success: true, data: step })
  } catch (err) {
    console.error('[ExecutionTasks] decide error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// PUT /api/execution-tasks/:id/handover
router.put('/:id/handover', (req, res) => {
  try {
    const { fromUser, toUser, reason, handedBy } = req.body
    const records = createTaskHandover({ executionTaskId: req.params.id, fromUser, toUser, reason, handedBy })
    const task = getExecutionTask(req.params.id)
    res.json({ success: true, data: { task: enrichTask(task), handoverRecords: records } })
  } catch (err) {
    console.error('[ExecutionTasks] handover error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// GET /api/execution-tasks/:id/handovers
router.get('/:id/handovers', (req, res) => {
  try {
    const records = getTaskHandovers(req.params.id)
    res.json({ data: records })
  } catch (err) {
    console.error('[ExecutionTasks] list handovers error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

export default router
