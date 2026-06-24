import fs from 'fs'
import path from 'path'
import type { Hook } from '../types'

const HOOKS_DIR = process.env.HOOKS_DIR || path.resolve(process.cwd(), '.claw/hooks')

export interface HookMeta {
  id: string
  name: string
  description: string
  event: string
  enabled: boolean
  matcher: string
}

export function loadHooks(): Hook[] {
  if (!fs.existsSync(HOOKS_DIR)) {
    return []
  }

  const files = fs.readdirSync(HOOKS_DIR)
  const hooks: Hook[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const filePath = path.join(HOOKS_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const id = file.replace('.json', '')

      hooks.push({
        id,
        name: data.name || id,
        description: data.description || '',
        event: data.event || 'before_chat',
        script: data.script || '',
        enabled: data.enabled !== false,
        matcher: data.matcher || '*',
      })
    } catch (err) {
      console.error(`[HookLoader] Failed to parse ${file}:`, err)
    }
  }

  return hooks
}

export function loadHooksMeta(): HookMeta[] {
  return loadHooks().map(({ id, name, description, event, enabled, matcher }) => ({
    id, name, description, event, enabled, matcher,
  }))
}

export function getHookById(id: string): Hook | undefined {
  return loadHooks().find((h) => h.id === id)
}

export function getHookRaw(id: string): string | null {
  const filePath = path.join(HOOKS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function saveHook(id: string, data: Omit<Hook, 'id'>): void {
  if (!fs.existsSync(HOOKS_DIR)) {
    fs.mkdirSync(HOOKS_DIR, { recursive: true })
  }
  const filePath = path.join(HOOKS_DIR, `${id}.json`)
  const content = JSON.stringify({ name: data.name, description: data.description, event: data.event, script: data.script, enabled: data.enabled, matcher: data.matcher }, null, 2)
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[HookLoader] Saved hook: ${id}`)
}

export function createHook(id: string, data: Omit<Hook, 'id'>): void {
  saveHook(id, data)
  console.log(`[HookLoader] Created hook: ${id}`)
}

export function deleteHook(id: string): boolean {
  const filePath = path.join(HOOKS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  console.log(`[HookLoader] Deleted hook: ${id}`)
  return true
}
