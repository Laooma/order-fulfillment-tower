import fs from 'fs'
import path from 'path'
import type { Skill, SkillFile } from '../types'

const SKILLS_DIR = process.env.SKILLS_DIR || path.resolve(process.cwd(), '../.claw/skills')

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {}
  let body = content

  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3)
    if (end !== -1) {
      const fmText = content.slice(3, end).trim()
      body = content.slice(end + 3).trim()
      for (const line of fmText.split('\n')) {
        const match = line.match(/^([\w-]+):\s*(.*)$/)
        if (match) {
          frontmatter[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
        }
      }
    }
  }

  return { frontmatter, body }
}

function parseListField(value: string): string[] {
  // Parse YAML list: "[Read, Bash, Grep]" or "Read, Bash, Grep"
  const inner = value.replace(/^\[|\]$/g, '').trim()
  if (!inner) return []
  return inner.split(',').map((s) => s.trim()).filter(Boolean)
}

function parseBoolField(value: string | undefined, defaultVal: boolean): boolean {
  if (!value) return defaultVal
  return value === 'true' || value === '1'
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function scanDir(dir: string, prefix: string): SkillFile[] {
  if (!fs.existsSync(dir)) return []
  const files: SkillFile[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const relPath = prefix + entry.name
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...scanDir(fullPath, relPath + '/'))
    } else {
      files.push({ id: relPath, name: entry.name })
    }
  }
  return files
}

function readSkillFile(skillId: string, filePath: string): { content: string; exists: boolean } {
  const fullPath = path.join(SKILLS_DIR, skillId, filePath)
  if (!fs.existsSync(fullPath)) return { content: '', exists: false }
  return { content: fs.readFileSync(fullPath, 'utf-8'), exists: true }
}

function migrateFlatSkill(id: string, flatFile: string): boolean {
  const content = fs.readFileSync(flatFile, 'utf-8')
  const skillDir = path.join(SKILLS_DIR, id)
  ensureDir(skillDir)
  const target = path.join(skillDir, 'SKILL.md')
  fs.writeFileSync(target, content, 'utf-8')
  fs.unlinkSync(flatFile)
  console.log(`[SkillLoader] Migrated flat skill "${id}.md" → "${id}/SKILL.md"`)
  return true
}

// ── Public API ──

export function loadSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.warn(`[SkillLoader] Skills directory not found: ${SKILLS_DIR}`)
    return []
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  const skills: Skill[] = []

  for (const entry of entries) {
    let skillId: string
    let skillMdPath: string

    // isDirectory() returns false for symlinks in Node 20+; resolve via stat
    const isDir = entry.isDirectory()
      || (entry.isSymbolicLink() && (() => { try { return fs.statSync(path.join(SKILLS_DIR, entry.name)).isDirectory() } catch { return false } })())
    if (isDir) {
      skillId = entry.name
      skillMdPath = path.join(SKILLS_DIR, skillId, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Legacy flat file — auto-migrate
      skillId = entry.name.replace('.md', '')
      const flatFile = path.join(SKILLS_DIR, entry.name)
      migrateFlatSkill(skillId, flatFile)
      skillMdPath = path.join(SKILLS_DIR, skillId, 'SKILL.md')
    } else {
      continue
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter(content)

    const skillDir = path.join(SKILLS_DIR, skillId)
    const references = scanDir(path.join(skillDir, 'references'), 'references/')
      .filter(f => f.name.endsWith('.md'))
    const scripts = scanDir(path.join(skillDir, 'scripts'), 'scripts/')
      .filter(f => !f.id.includes('/templates/'))
    const templates = scanDir(path.join(skillDir, 'scripts', 'templates'), 'scripts/templates/')

    skills.push({
      id: skillId,
      name: frontmatter.name || skillId,
      description: frontmatter.description || '',
      icon: frontmatter.icon || 'bot',
      color: frontmatter.color || 'ai-purple',
      prompt: body,
      references,
      scripts,
      templates,
      allowedTools: frontmatter['allowed-tools'] ? parseListField(frontmatter['allowed-tools']) : undefined,
      userInvocable: parseBoolField(frontmatter['user-invocable'], true),
      disableModelInvocation: parseBoolField(frontmatter['disable-model-invocation'], false),
      model: frontmatter.model || undefined,
    })
  }

  return skills
}

export function loadSkillFull(id: string): Skill | null {
  const skillDir = path.join(SKILLS_DIR, id)
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  const content = fs.readFileSync(skillMdPath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(content)

  const references = scanDir(path.join(skillDir, 'references'), 'references/')
    .filter(f => f.name.endsWith('.md'))
  const scripts = scanDir(path.join(skillDir, 'scripts'), 'scripts/')
    .filter(f => !f.id.includes('/templates/'))
  const templates = scanDir(path.join(skillDir, 'scripts', 'templates'), 'scripts/templates/')

  return {
    id,
    name: frontmatter.name || id,
    description: frontmatter.description || '',
    icon: frontmatter.icon || 'bot',
    color: frontmatter.color || 'ai-purple',
    prompt: body,
    references,
    scripts,
    templates,
    allowedTools: frontmatter['allowed-tools'] ? parseListField(frontmatter['allowed-tools']) : undefined,
    userInvocable: parseBoolField(frontmatter['user-invocable'], true),
    disableModelInvocation: parseBoolField(frontmatter['disable-model-invocation'], false),
    model: frontmatter.model || undefined,
  }
}

export function getSkillById(id: string): Skill | undefined {
  return loadSkills().find((s) => s.id === id)
}

export function getSkillRaw(id: string): string | null {
  const skillMdPath = path.join(SKILLS_DIR, id, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null
  return fs.readFileSync(skillMdPath, 'utf-8')
}

export function getSkillFile(id: string, filePath: string): { data: { id: string; name: string; content: string } } | { error: string } {
  const fullPath = path.join(SKILLS_DIR, id, filePath)
  if (!fs.existsSync(fullPath)) return { error: 'File not found' }
  const content = fs.readFileSync(fullPath, 'utf-8')
  const fileName = path.basename(filePath)
  return { data: { id: filePath, name: fileName, content } }
}

export function saveSkill(id: string, content: string): void {
  const skillDir = path.join(SKILLS_DIR, id)
  ensureDir(skillDir)
  const filePath = path.join(skillDir, 'SKILL.md')
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[SkillLoader] Saved skill: ${id}/SKILL.md`)
}

export function saveSkillFile(id: string, filePath: string, content: string): { success: boolean; error?: string } {
  const skillDir = path.join(SKILLS_DIR, id)
  const fullPath = path.join(skillDir, filePath)
  // Security: ensure the resolved path is within the skill directory
  if (!fullPath.startsWith(skillDir)) return { success: false, error: 'Invalid file path' }
  const parentDir = path.dirname(fullPath)
  ensureDir(parentDir)
  fs.writeFileSync(fullPath, content, 'utf-8')
  console.log(`[SkillLoader] Saved file: ${id}/${filePath}`)
  return { success: true }
}

export function deleteSkill(id: string): boolean {
  const skillDir = path.join(SKILLS_DIR, id)
  if (!fs.existsSync(skillDir)) return false
  fs.rmSync(skillDir, { recursive: true, force: true })
  console.log(`[SkillLoader] Deleted skill: ${id}`)
  return true
}

export function deleteSkillFile(id: string, filePath: string): boolean {
  const fullPath = path.join(SKILLS_DIR, id, filePath)
  const skillDir = path.join(SKILLS_DIR, id)
  if (!fullPath.startsWith(skillDir)) return false
  if (!fs.existsSync(fullPath)) return false
  fs.unlinkSync(fullPath)
  console.log(`[SkillLoader] Deleted file: ${id}/${filePath}`)
  return true
}

export function createSkill(
  id: string,
  frontmatter: { name: string; description: string; icon: string; color: string },
  prompt: string,
): void {
  const skillDir = path.join(SKILLS_DIR, id)
  ensureDir(skillDir)
  const content = `---
name: ${frontmatter.name}
description: ${frontmatter.description}
icon: ${frontmatter.icon}
color: ${frontmatter.color}
---

${prompt}`
  const filePath = path.join(skillDir, 'SKILL.md')
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[SkillLoader] Created skill: ${id}/SKILL.md`)
}
