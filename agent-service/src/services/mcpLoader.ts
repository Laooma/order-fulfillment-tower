import fs from 'fs'
import path from 'path'
import type { McpServer } from '../types'

const MCP_DIR = process.env.MCP_DIR || path.resolve(process.cwd(), '../.claw/mcp')

export interface McpServerMeta {
  id: string
  name: string
  description: string
  command: string
  enabled: boolean
  autoConnect: boolean
}

export function loadMcpServers(): McpServer[] {
  if (!fs.existsSync(MCP_DIR)) {
    return []
  }

  const files = fs.readdirSync(MCP_DIR)
  const servers: McpServer[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const filePath = path.join(MCP_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const id = file.replace('.json', '')

      servers.push({
        id,
        name: data.name || id,
        description: data.description || '',
        command: data.command || '',
        args: data.args || [],
        env: data.env || {},
        enabled: data.enabled !== false,
        autoConnect: data.autoConnect !== false,
      })
    } catch (err) {
      console.error(`[McpLoader] Failed to parse ${file}:`, err)
    }
  }

  return servers
}

export function loadMcpServersMeta(): McpServerMeta[] {
  return loadMcpServers().map(({ id, name, description, command, enabled, autoConnect }) => ({
    id, name, description, command, enabled, autoConnect,
  }))
}

export function getMcpServerById(id: string): McpServer | undefined {
  return loadMcpServers().find((s) => s.id === id)
}

export function getMcpServerRaw(id: string): string | null {
  const filePath = path.join(MCP_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
}

export function saveMcpServer(id: string, data: Omit<McpServer, 'id'>): void {
  if (!fs.existsSync(MCP_DIR)) {
    fs.mkdirSync(MCP_DIR, { recursive: true })
  }
  const filePath = path.join(MCP_DIR, `${id}.json`)
  const content = JSON.stringify({
    name: data.name,
    description: data.description,
    command: data.command,
    args: data.args,
    env: data.env,
    enabled: data.enabled,
    autoConnect: data.autoConnect,
  }, null, 2)
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[McpLoader] Saved MCP server: ${id}`)
}

export function createMcpServer(id: string, data: Omit<McpServer, 'id'>): void {
  saveMcpServer(id, data)
  console.log(`[McpLoader] Created MCP server: ${id}`)
}

export function deleteMcpServer(id: string): boolean {
  const filePath = path.join(MCP_DIR, `${id}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  console.log(`[McpLoader] Deleted MCP server: ${id}`)
  return true
}
