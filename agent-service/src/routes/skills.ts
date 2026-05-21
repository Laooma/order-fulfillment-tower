import { Router } from 'express'
import {
  loadSkills,
  loadSkillFull,
  getSkillRaw,
  getSkillFile,
  saveSkill,
  saveSkillFile,
  createSkill,
  deleteSkill,
  deleteSkillFile,
} from '../services/skillLoader'

const router = Router()

// GET /skills — list all (metadata only, no body)
router.get('/', (_req, res) => {
  const skills = loadSkills().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    color: s.color,
    references: s.references,
    scripts: s.scripts,
    templates: s.templates,
    userInvocable: s.userInvocable,
    disableModelInvocation: s.disableModelInvocation,
    model: s.model,
  }))
  res.json({ skills })
})

// GET /skills/:id — single skill metadata (no body)
router.get('/:id', (req, res) => {
  const skill = loadSkillFull(req.params.id)
  if (!skill) {
    res.status(404).json({ error: 'Skill not found' })
    return
  }
  res.json({
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      color: skill.color,
      references: skill.references,
      scripts: skill.scripts,
      templates: skill.templates,
      userInvocable: skill.userInvocable,
      disableModelInvocation: skill.disableModelInvocation,
      model: skill.model,
      allowedTools: skill.allowedTools,
    },
  })
})

// GET /skills/:id/full — skill with body + all files
router.get('/:id/full', (req, res) => {
  const skill = loadSkillFull(req.params.id)
  if (!skill) {
    res.status(404).json({ error: 'Skill not found' })
    return
  }
  res.json({ skill })
})

// GET /skills/:id/raw — SKILL.md raw content
router.get('/:id/raw', (req, res) => {
  const content = getSkillRaw(req.params.id)
  if (content === null) {
    res.status(404).json({ error: 'Skill not found' })
    return
  }
  res.json({ id: req.params.id, content })
})

// GET /skills/:id/files/*path — read a reference/script file
router.get('/:id/files/*path', (req, res) => {
  const pathArr = (req.params as any).path
  const filePath = Array.isArray(pathArr) ? pathArr.join('/') : (pathArr || '')
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' })
    return
  }
  const result = getSkillFile(req.params.id, filePath)
  if ('error' in result) {
    res.status(404).json(result)
    return
  }
  res.json(result)
})

// PUT /skills/:id — update SKILL.md
router.put('/:id', (req, res) => {
  const { content } = req.body
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' })
    return
  }
  saveSkill(req.params.id, content)
  res.json({ success: true })
})

// PUT /skills/:id/files/*path — save/update a reference/script file
router.put('/:id/files/*path', (req, res) => {
  const pathArr = (req.params as any).path
  const filePath = Array.isArray(pathArr) ? pathArr.join('/') : (pathArr || '')
  const { content } = req.body
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' })
    return
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' })
    return
  }
  const result = saveSkillFile(req.params.id, filePath, content)
  if (!result.success) {
    res.status(400).json(result)
    return
  }
  res.json({ success: true })
})

// POST /skills — create new skill
router.post('/', (req, res) => {
  const { id, name, description, icon, color, content } = req.body
  if (!id || !name || !content) {
    res.status(400).json({ error: 'id, name, and content are required' })
    return
  }
  createSkill(id, { name, description: description || '', icon: icon || 'bot', color: color || 'ai-purple' }, content)
  res.json({ success: true })
})

// DELETE /skills/:id/files/*path — delete a reference/script file
router.delete('/:id/files/*path', (req, res) => {
  const pathArr = (req.params as any).path
  const filePath = Array.isArray(pathArr) ? pathArr.join('/') : (pathArr || '')
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' })
    return
  }
  const ok = deleteSkillFile(req.params.id, filePath)
  if (!ok) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  res.json({ success: true })
})

// DELETE /skills/:id — delete entire skill directory
router.delete('/:id', (req, res) => {
  const ok = deleteSkill(req.params.id)
  if (!ok) {
    res.status(404).json({ error: 'Skill not found' })
    return
  }
  res.json({ success: true })
})

export default router
