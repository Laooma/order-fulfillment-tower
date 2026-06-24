import fs from 'fs'
import path from 'path'
import type { Plugin } from '../types'

const PLUGINS_DIR = process.env.PLUGINS_DIR || path.resolve(process.cwd(), '.claw/plugins')

export interface PluginMeta {
  id: string
  name: string
  description: string
  version: string
  type: string
  enabled: boolean
}

export function loadPlugins(): Plugin[] {
  if (!fs.existsSync(PLUGINS_DIR)) {
    return []
  }

  const files = fs.readdirSync(PLUGINS_DIR)
  const plugins: Plugin[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const filePath = path.join(PLUGINS_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const id = file.replace('.json', '')

      plugins.push({
        id,
        name: data.name || id,
        description: data.description || '',
        version: data.version || '1.0.0',
        type: data.type || 'tool',
        entry: data.entry || '',
        enabled: data.enabled !== false,
        config: data.config || {},
      })
    } catch (err) {
      console.error(`[PluginLoader] Failed to parse ${file}:`, err)
    }
  }

  return plugins
}

export function loadPluginsMeta(): PluginMeta[] {
  return loadPlugins().map(({ id, name, description, version, type, enabled }) => ({
    id, name, description, version, type, enabled,
  }))
}

export function getPluginById(id: string): Plugin | undefined {
  return loadPlugins().find((p) => p.id === id)
}

export function getPluginRaw(id: string): string | null {
  const filePath = path.join(PLUGINS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function savePlugin(id: string, data: Omit<Plugin, 'id'>): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  }
  const filePath = path.join(PLUGINS_DIR, `${id}.json`)
  const content = JSON.stringify({
    name: data.name,
    description: data.description,
    version: data.version,
    type: data.type,
    entry: data.entry,
    enabled: data.enabled,
    config: data.config,
  }, null, 2)
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[PluginLoader] Saved plugin: ${id}`)
}

export function createPlugin(id: string, data: Omit<Plugin, 'id'>): void {
  savePlugin(id, data)
  console.log(`[PluginLoader] Created plugin: ${id}`)
}

export function deletePlugin(id: string): boolean {
  const filePath = path.join(PLUGINS_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  console.log(`[PluginLoader] Deleted plugin: ${id}`)
  return true
}
