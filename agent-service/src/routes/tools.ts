import { Router } from 'express'
import type { McpPool } from '../services/mcpPool'
import { getAllTools, getToolConfig, updateToolConfig } from '../services/toolManager'

export function createToolsRouter(mcpPool: McpPool): Router {
  const router = Router()

  // GET /tools — list all tools
  router.get('/', (_req, res) => {
    const tools = getAllTools(mcpPool)
    res.json({ tools })
  })

  // GET /tools/:name — single tool detail
  router.get('/:name', (req, res) => {
    const tool = getToolConfig(req.params.name, mcpPool)
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' })
      return
    }
    res.json({ tool })
  })

  // PUT /tools/:name — update tool config
  router.put('/:name', (req, res) => {
    const { enabled, description } = req.body
    const result = updateToolConfig(req.params.name, { enabled, description })
    if (!result.success) {
      res.status(400).json(result)
      return
    }
    res.json({ success: true })
  })

  return router
}
