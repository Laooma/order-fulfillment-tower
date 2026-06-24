import fs from 'fs'
import path from 'path'
import type { CronTask } from '../types'

const CRON_TASKS_DIR = process.env.CRON_TASKS_DIR || path.resolve(process.cwd(), '.claw/cron-tasks')

function ensureDir(): void {
  if (!fs.existsSync(CRON_TASKS_DIR)) {
    fs.mkdirSync(CRON_TASKS_DIR, { recursive: true })
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function loadCronTasks(): CronTask[] {
  ensureDir()
  const files = fs.readdirSync(CRON_TASKS_DIR)
  const tasks: CronTask[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const filePath = path.join(CRON_TASKS_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const id = file.replace('.json', '')
      tasks.push({
        id,
        name: data.name || id,
        description: data.description || '',
        enabled: data.enabled !== false,
        schedule: data.schedule || '0 9 * * *',
        script: data.script || '',
        scriptType: data.scriptType || 'bash',
        callAgent: data.callAgent === true,
        agentSkillId: data.agentSkillId || '',
        agentPrompt: data.agentPrompt || '',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      })
    } catch (err) {
      console.error(`[CronTaskLoader] Failed to parse ${file}:`, err)
    }
  }

  return tasks
}

export function loadCronTask(id: string): CronTask | null {
  ensureDir()
  const safeId = sanitizeId(id)
  const filePath = path.join(CRON_TASKS_DIR, `${safeId}.json`)
  if (!fs.existsSync(filePath)) return null
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content)
    return {
      id: safeId,
      name: data.name || safeId,
      description: data.description || '',
      enabled: data.enabled !== false,
      schedule: data.schedule || '0 9 * * *',
      script: data.script || '',
      scriptType: data.scriptType || 'bash',
      callAgent: data.callAgent === true,
      agentSkillId: data.agentSkillId || '',
      agentPrompt: data.agentPrompt || '',
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    }
  } catch (err) {
    console.error(`[CronTaskLoader] Failed to load ${id}:`, err)
    return null
  }
}

export function saveCronTask(id: string, data: Partial<CronTask>): { success: boolean; error?: string } {
  ensureDir()
  const safeId = sanitizeId(id)
  const filePath = path.join(CRON_TASKS_DIR, `${safeId}.json`)

  const existing = loadCronTask(safeId)
  const now = new Date().toISOString()

  const task = {
    name: data.name ?? existing?.name ?? safeId,
    description: data.description ?? existing?.description ?? '',
    enabled: data.enabled ?? existing?.enabled ?? true,
    schedule: data.schedule ?? existing?.schedule ?? '0 9 * * *',
    script: data.script ?? existing?.script ?? '',
    scriptType: data.scriptType ?? existing?.scriptType ?? 'bash',
    callAgent: data.callAgent ?? existing?.callAgent ?? false,
    agentSkillId: data.agentSkillId ?? existing?.agentSkillId ?? '',
    agentPrompt: data.agentPrompt ?? existing?.agentPrompt ?? '',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export function createCronTask(data: { id: string; name: string; description?: string; schedule?: string; script?: string; scriptType?: 'bash' | 'python' | 'js'; callAgent?: boolean; agentSkillId?: string; agentPrompt?: string }): { success: boolean; error?: string } {
  const safeId = sanitizeId(data.id)
  const filePath = path.join(CRON_TASKS_DIR, `${safeId}.json`)
  if (fs.existsSync(filePath)) {
    return { success: false, error: 'Task already exists' }
  }
  return saveCronTask(safeId, {
    name: data.name,
    description: data.description,
    schedule: data.schedule,
    script: data.script,
    scriptType: data.scriptType,
    callAgent: data.callAgent,
    agentSkillId: data.agentSkillId,
    agentPrompt: data.agentPrompt,
    enabled: true,
  })
}

export function deleteCronTask(id: string): boolean {
  ensureDir()
  const safeId = sanitizeId(id)
  const filePath = path.join(CRON_TASKS_DIR, `${safeId}.json`)
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}

export function getLogsDir(taskId: string): string {
  const dir = path.join(CRON_TASKS_DIR, 'logs', sanitizeId(taskId))
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}
