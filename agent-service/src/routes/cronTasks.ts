import { Router } from 'express'
import { loadCronTasks, loadCronTask, createCronTask, saveCronTask, deleteCronTask } from '../services/cronTaskLoader'
import { CronScheduler } from '../services/cronScheduler'
import { handleAgentHttpRequest } from '../services/agentLoop'

export function createCronTasksRouter(scheduler: CronScheduler) {
  const router = Router()

  // GET /cron-tasks — list all
  router.get('/', (_req, res) => {
    const tasks = loadCronTasks()
    res.json({ tasks })
  })

  // GET /cron-tasks/:id
  router.get('/:id', (req, res) => {
    const task = loadCronTask(req.params.id)
    if (!task) {
      res.status(404).json({ error: 'Cron task not found' })
      return
    }
    res.json({ task })
  })

  // POST /cron-tasks — create new
  router.post('/', (req, res) => {
    const { id, name, description, schedule, script, scriptType, callAgent, agentSkillId, agentPrompt } = req.body
    if (!id || !name) {
      res.status(400).json({ error: 'id and name are required' })
      return
    }
    const result = createCronTask({ id, name, description, schedule, script, scriptType, callAgent, agentSkillId, agentPrompt })
    if (!result.success) {
      res.status(400).json(result)
      return
    }
    const task = loadCronTask(id)
    if (task?.enabled) {
      scheduler.scheduleTask(id)
    }
    res.json({ success: true })
  })

  // PUT /cron-tasks/:id — update
  router.put('/:id', (req, res) => {
    const { name, description, schedule, script, scriptType, callAgent, agentSkillId, agentPrompt, enabled } = req.body
    const result = saveCronTask(req.params.id, {
      name, description, schedule, script, scriptType, callAgent, agentSkillId, agentPrompt, enabled,
    })
    if (!result.success) {
      res.status(400).json(result)
      return
    }
    scheduler.reloadTask(req.params.id)
    res.json({ success: true })
  })

  // DELETE /cron-tasks/:id
  router.delete('/:id', (req, res) => {
    scheduler.unscheduleTask(req.params.id)
    const ok = deleteCronTask(req.params.id)
    if (!ok) {
      res.status(404).json({ error: 'Cron task not found' })
      return
    }
    res.json({ success: true })
  })

  // POST /cron-tasks/:id/run — manual trigger
  router.post('/:id/run', async (req, res) => {
    const result = await scheduler.runTaskNow(req.params.id)
    res.json(result)
  })

  return router
}

// Separate router for /api/run-agent — programmatic agent invocation
export function createApiRouter() {
  const router = Router()

  router.post('/run-agent', async (req, res) => {
    const { skillId, prompt } = req.body
    if (!skillId || !prompt) {
      res.status(400).json({ error: 'skillId and prompt are required' })
      return
    }

    try {
      const result = await handleAgentHttpRequest(skillId, prompt)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  return router
}
