import cron from 'node-cron'
import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { loadCronTasks, loadCronTask, getLogsDir } from './cronTaskLoader'

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:3002'

interface ScheduledJob {
  id: string
  task: ReturnType<typeof cron.schedule>
}

export class CronScheduler {
  private jobs = new Map<string, ScheduledJob>()

  start(): void {
    const tasks = loadCronTasks()
    console.log(`[CronScheduler] Starting ${tasks.length} tasks...`)
    for (const task of tasks) {
      if (task.enabled) {
        this.scheduleTask(task.id)
      }
    }
  }

  stop(): void {
    for (const [id, job] of this.jobs) {
      job.task.stop()
      console.log(`[CronScheduler] Stopped: ${id}`)
    }
    this.jobs.clear()
  }

  scheduleTask(id: string): boolean {
    const task = loadCronTask(id)
    if (!task) return false
    if (!task.schedule) return false

    // Stop existing job if any
    this.unscheduleTask(id)

    if (!cron.validate(task.schedule)) {
      console.error(`[CronScheduler] Invalid cron expression for ${id}: ${task.schedule}`)
      return false
    }

    const job = cron.schedule(task.schedule, () => {
      console.log(`[CronScheduler] Running task: ${id} (${task.name})`)
      this.executeTask(task)
    })

    this.jobs.set(id, { id, task: job })
    console.log(`[CronScheduler] Scheduled: ${id} (${task.schedule})`)
    return true
  }

  unscheduleTask(id: string): void {
    const existing = this.jobs.get(id)
    if (existing) {
      existing.task.stop()
      this.jobs.delete(id)
    }
  }

  reloadTask(id: string): void {
    this.scheduleTask(id)
  }

  async runTaskNow(id: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const task = loadCronTask(id)
    if (!task) return { success: false, error: 'Task not found' }
    return this.executeTask(task)
  }

  private async executeTask(task: { id: string; name: string; script: string; scriptType: string; callAgent: boolean; agentSkillId?: string; agentPrompt?: string }): Promise<{ success: boolean; output?: string; error?: string }> {
    const logDir = getLogsDir(task.id)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const logFile = path.join(logDir, `${timestamp}.log`)

    const results: string[] = []
    const log = (msg: string) => {
      console.log(`[CronTask:${task.id}] ${msg}`)
      results.push(msg)
    }

    try {
      // If callAgent is enabled, send HTTP request to run-agent endpoint
      if (task.callAgent && task.agentSkillId && task.agentPrompt) {
        log(`Calling agent with skill: ${task.agentSkillId}`)
        try {
          const response = await fetch(`${AGENT_SERVICE_URL}/api/run-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              skillId: task.agentSkillId,
              prompt: task.agentPrompt,
            }),
          })
          const result = await response.json()
          log(`Agent response: ${JSON.stringify(result)}`)
        } catch (err) {
          log(`Agent call failed: ${(err as Error).message}`)
        }
      }

      // Execute the script
      if (task.script.trim()) {
        const interpreter = task.scriptType === 'python' ? 'python3' : task.scriptType === 'js' ? 'node' : 'bash'
        const scriptContent = task.script

        log(`Executing ${task.scriptType} script with ${interpreter}...`)

        await new Promise<void>((resolve) => {
          const child = exec(scriptContent, {
            env: {
              ...process.env,
              CRON_TASK_ID: task.id,
              CRON_TASK_NAME: task.name,
              AGENT_SERVICE_URL,
            },
            timeout: 300000, // 5 min timeout
            maxBuffer: 1024 * 1024, // 1MB
          })

          let stdout = ''
          let stderr = ''

          child.stdout?.on('data', (data) => { stdout += data.toString() })
          child.stderr?.on('data', (data) => { stderr += data.toString() })

          child.on('close', (code) => {
            if (stdout) log(`stdout:\n${stdout}`)
            if (stderr) log(`stderr:\n${stderr}`)
            log(`Script exited with code ${code}`)
            resolve()
          })

          child.on('error', (err) => {
            log(`Script execution error: ${err.message}`)
            resolve()
          })
        })
      }

      const logContent = results.join('\n')
      fs.writeFileSync(logFile, logContent, 'utf-8')
      return { success: true, output: logContent }
    } catch (err) {
      const errorMsg = `Execution error: ${(err as Error).message}`
      log(errorMsg)
      fs.writeFileSync(logFile, results.join('\n'), 'utf-8')
      return { success: false, error: errorMsg, output: results.join('\n') }
    }
  }
}
