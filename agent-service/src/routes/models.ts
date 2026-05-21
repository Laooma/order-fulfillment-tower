import { Router } from 'express'
import { getAllModels, getDefaultModel, getRawConfig, saveConfig } from '../services/llmConfig'

const router = Router()

router.get('/', (_req, res) => {
  const models = getAllModels()
  res.json({ models, defaultModel: getDefaultModel() })
})

router.get('/config', (_req, res) => {
  res.json(getRawConfig())
})

router.put('/config', (req, res) => {
  try {
    saveConfig(req.body)
    res.json({ success: true })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

export default router
