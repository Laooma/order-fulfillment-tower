import { Router } from 'express'
import { loadHooks, loadHooksMeta, getHookRaw, saveHook, createHook, deleteHook } from '../services/hookLoader'

const router = Router()

router.get('/', (_req, res) => {
  const hooks = loadHooksMeta()
  res.json({ hooks })
})

router.get('/:id', (req, res) => {
  const raw = getHookRaw(req.params.id)
  if (raw === null) {
    res.status(404).json({ error: 'Hook not found' })
    return
  }
  try {
    res.json({ hook: JSON.parse(raw) })
  } catch {
    res.status(500).json({ error: 'Failed to parse hook' })
  }
})

router.get('/:id/raw', (req, res) => {
  const raw = getHookRaw(req.params.id)
  if (raw === null) {
    res.status(404).json({ error: 'Hook not found' })
    return
  }
  res.json({ id: req.params.id, content: raw })
})

router.put('/:id', (req, res) => {
  const { name, description, event, script, enabled, matcher } = req.body
  if (!name || !event || script === undefined) {
    res.status(400).json({ error: 'name, event, and script are required' })
    return
  }
  saveHook(req.params.id, {
    name,
    description: description || '',
    event,
    script,
    enabled: enabled !== false,
    matcher: matcher || '*',
  })
  res.json({ success: true })
})

router.post('/', (req, res) => {
  const { id, name, description, event, script, enabled, matcher } = req.body
  if (!id || !name || !event || script === undefined) {
    res.status(400).json({ error: 'id, name, event, and script are required' })
    return
  }
  createHook(id, {
    name,
    description: description || '',
    event,
    script,
    enabled: enabled !== false,
    matcher: matcher || '*',
  })
  res.json({ success: true })
})

router.delete('/:id', (req, res) => {
  const ok = deleteHook(req.params.id)
  if (!ok) {
    res.status(404).json({ error: 'Hook not found' })
    return
  }
  res.json({ success: true })
})

export default router
