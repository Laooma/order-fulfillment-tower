import { Router } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()

const CLAW_PATH = path.resolve(process.cwd(), '../CLAW.md')

// GET /api/claw — read CLAW.md content
router.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(CLAW_PATH)) {
      res.json({ content: '' })
      return
    }
    const content = fs.readFileSync(CLAW_PATH, 'utf-8')
    res.json({ content })
  } catch (err) {
    console.error('[CLAW] Read error:', err)
    res.status(500).json({ error: 'Failed to read CLAW.md' })
  }
})

// PUT /api/claw — save CLAW.md content
router.put('/', (req, res) => {
  try {
    const { content } = req.body
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' })
      return
    }
    fs.writeFileSync(CLAW_PATH, content, 'utf-8')
    res.json({ success: true })
  } catch (err) {
    console.error('[CLAW] Write error:', err)
    res.status(500).json({ error: 'Failed to write CLAW.md' })
  }
})

export default router
