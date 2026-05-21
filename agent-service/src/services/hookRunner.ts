import { exec } from 'child_process'
import { loadHooks } from './hookLoader'
import type { Hook } from '../types'

const HOOK_TIMEOUT_MS = parseInt(process.env.HOOK_TIMEOUT_MS || '30000', 10)

export interface HookContext {
  sessionId?: string
  skillId?: string
  skillName?: string
  message?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  errorMessage?: string
  [key: string]: unknown
}

export interface HookResult {
  hookId: string
  hookName: string
  event: string
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  modifiedContext?: Partial<HookContext>
}

function executeScript(script: string, context: HookContext, timeoutMs: number): Promise<HookResult> {
  return new Promise((resolve) => {
    const contextJson = JSON.stringify(context)
    const escapedContext = contextJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    const child = exec(
      script,
      {
        timeout: timeoutMs,
        env: {
          ...process.env,
          HOOK_CONTEXT: contextJson,
          HOOK_EVENT: (context.event as string) || '',
          HOOK_SESSION_ID: context.sessionId || '',
        },
        maxBuffer: 1024 * 1024, // 1MB
      },
      (error, stdout, stderr) => {
        resolve({
          hookId: '',
          hookName: '',
          event: (context.event as string) || '',
          stdout: stdout?.trim() || '',
          stderr: stderr?.trim() || '',
          exitCode: error?.code || 0,
          timedOut: (error as any)?.killed || false,
          modifiedContext: parseModifiedContext(stdout?.trim() || ''),
        })
      },
    )
  })
}

function parseModifiedContext(stdout: string): Partial<HookContext> | undefined {
  if (!stdout) return undefined
  try {
    const parsed = JSON.parse(stdout)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed
    }
  } catch {
    // stdout is not JSON — treat as plain text modification
  }
  return undefined
}

export async function runHooks(
  event: Hook['event'],
  context: HookContext,
): Promise<HookResult[]> {
  const hooks = loadHooks().filter(
    (h) => h.enabled && h.event === event,
  )

  if (hooks.length === 0) return []

  const results: HookResult[] = []

  for (const hook of hooks) {
    // Check matcher
    if (hook.matcher && hook.matcher !== '*') {
      const eventKey =
        event === 'before_tool_call' || event === 'after_tool_call'
          ? context.toolName
          : context.skillName
      if (eventKey && !new RegExp(hook.matcher).test(eventKey)) {
        continue
      }
    }

    console.log(`[HookRunner] Running hook "${hook.name}" (${hook.id}) for event ${event}`)

    const ctx: HookContext = { ...context, event }
    const result = await executeScript(hook.script, ctx, HOOK_TIMEOUT_MS)
    result.hookId = hook.id
    result.hookName = hook.name

    if (result.stderr) {
      console.warn(`[HookRunner] Hook "${hook.name}" stderr:`, result.stderr)
    }
    if (result.timedOut) {
      console.warn(`[HookRunner] Hook "${hook.name}" timed out after ${HOOK_TIMEOUT_MS}ms`)
    }

    results.push(result)

    // Merge modified context for the next hook
    if (result.modifiedContext) {
      Object.assign(context, result.modifiedContext)
    }
  }

  return results
}
