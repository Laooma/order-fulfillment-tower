import { Router } from 'express'
import { loadPluginsMeta, getPluginRaw, savePlugin, createPlugin, deletePlugin } from '../services/pluginLoader'

const router = Router()

router.get('/', (_req, res) => {
  const plugins = loadPluginsMeta()
  res.json({ plugins })
})

router.get('/:id', (req, res) => {
  const raw = getPluginRaw(req.params.id)
  if (raw === null) {
    res.status(404).json({ error: 'Plugin not found' })
    return
  }
  try {
    res.json({ plugin: JSON.parse(raw) })
  } catch {
    res.status(500).json({ error: 'Failed to parse plugin config' })
  }
})

router.get('/:id/raw', (req, res) => {
  const raw = getPluginRaw(req.params.id)
  if (raw === null) {
    res.status(404).json({ error: 'Plugin not found' })
    return
  }
  res.json({ id: req.params.id, content: raw })
})

router.put('/:id', (req, res) => {
  const { name, description, version, type, entry, enabled, config } = req.body
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  savePlugin(req.params.id, {
    name,
    description: description || '',
    version: version || '1.0.0',
    type: type || 'tool',
    entry: entry || '',
    enabled: enabled !== false,
    config: config || {},
  })
  res.json({ success: true })
})

router.post('/', (req, res) => {
  const { id, name, description, version, type, entry, enabled, config } = req.body
  if (!id || !name) {
    res.status(400).json({ error: 'id and name are required' })
    return
  }
  createPlugin(id, {
    name,
    description: description || '',
    version: version || '1.0.0',
    type: type || 'tool',
    entry: entry || '',
    enabled: enabled !== false,
    config: config || {},
  })
  res.json({ success: true })
})

router.delete('/:id', (req, res) => {
  const ok = deletePlugin(req.params.id)
  if (!ok) {
    res.status(404).json({ error: 'Plugin not found' })
    return
  }
  res.json({ success: true })
})

export default router
