import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Extract parent analysis task ID from a todo/subtask ID.
 *  Analysis-generated todos have pattern: {analysisTaskId}_{contractNumber}_todo_{index}
 *  e.g. T20260518001_SF20241202001_todo_0 → T20260518001 */
export function getAnalysisTaskId(taskOrTodoId: string): string {
  const match = taskOrTodoId.match(/^(T\d+)_/)
  return match ? match[1] : taskOrTodoId
}
