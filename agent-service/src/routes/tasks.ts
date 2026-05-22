import { Router } from 'express'
import type { SessionStore } from '../services/sessionStore'

export function createTasksRouter(sessionStore: SessionStore): Router {
  const router = Router()

  router.get('/:sessionId', (req, res) => {
    try {
      const tasks = sessionStore.loadTasks(req.params.sessionId)
      res.json({ data: tasks })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
