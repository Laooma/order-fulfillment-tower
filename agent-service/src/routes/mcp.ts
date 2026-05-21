import { Router } from 'express'
import { loadMcpServersMeta, getMcpServerRaw, saveMcpServer, createMcpServer, deleteMcpServer } from '../services/mcpLoader'

const router = Router()

router.get('/', (_req, res) => {
  const servers = loadMcpServersMeta()
  res.json({ servers })
})

router.get('/:id', (req, res) => {
  const raw = getMcpServerRaw(req.params.id)
  if (raw === null) {
    res.status(404).json({ error: 'MCP server not found' })
    return
  }
  try {
    res.json({ server: JSON.parse(raw) })
  } catch {
    res.status(500).json({ error: 'Failed to parse MCP server config' })
  }
})

router.get('/:id/raw', (req, res) => {
  const raw = getMcpServerRaw(req.params.id)
  if (raw === null) {
    res.status(404).json({ error: 'MCP server not found' })
    return
  }
  res.json({ id: req.params.id, content: raw })
})

router.put('/:id', (req, res) => {
  const { name, description, command, args, env, enabled, autoConnect } = req.body
  if (!name || !command) {
    res.status(400).json({ error: 'name and command are required' })
    return
  }
  saveMcpServer(req.params.id, {
    name,
    description: description || '',
    command,
    args: args || [],
    env: env || {},
    enabled: enabled !== false,
    autoConnect: autoConnect !== false,
  })
  res.json({ success: true })
})

router.post('/', (req, res) => {
  const { id, name, description, command, args, env, enabled, autoConnect } = req.body
  if (!id || !name || !command) {
    res.status(400).json({ error: 'id, name, and command are required' })
    return
  }
  createMcpServer(id, {
    name,
    description: description || '',
    command,
    args: args || [],
    env: env || {},
    enabled: enabled !== false,
    autoConnect: autoConnect !== false,
  })
  res.json({ success: true })
})

router.delete('/:id', (req, res) => {
  const ok = deleteMcpServer(req.params.id)
  if (!ok) {
    res.status(404).json({ error: 'MCP server not found' })
    return
  }
  res.json({ success: true })
})

export default router
