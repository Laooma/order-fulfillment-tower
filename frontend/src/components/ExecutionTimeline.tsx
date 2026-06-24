import { Bot, Hand, Scale } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ExecutionStep } from '../types'

interface ExecutionTimelineProps {
  steps: ExecutionStep[]
  currentStepId?: string
  onStepClick?: (step: ExecutionStep) => void
}

const typeIcons: Record<string, React.ReactNode> = {
  agent: <Bot size={14} />,
  manual: <Hand size={14} />,
  decision: <Scale size={14} />,
}

const typeLabels: Record<string, string> = {
  agent: 'Agent',
  manual: '手工',
  decision: '决策',
}

const statusClasses: Record<string, string> = {
  done: 'success',
  progress: 'accent',
  overdue: 'danger',
  pending: 'muted',
}

function formatDuration(seconds?: number) {
  if (!seconds) return ''
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分`
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`
}

export default function ExecutionTimeline({ steps, currentStepId, onStepClick }: ExecutionTimelineProps) {
  // Only show completed steps + the first pending step (hide future steps)
  const firstPendingIdx = steps.findIndex((s) => s.status !== 'done')
  const visibleSteps = firstPendingIdx === -1 ? steps : steps.slice(0, firstPendingIdx + 1)
  const doneCount = steps.filter((s) => s.status === 'done').length

  if (!steps || steps.length === 0) {
    return (
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">执行步骤</span>
        </div>
        <div className="detail-card-body text-muted text-sm py-6 text-center">
          暂无步骤
        </div>
      </div>
    )
  }

  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <span className="detail-card-title">执行步骤</span>
        <span className="text-[11px] text-muted font-mono">
          {doneCount} / {steps.length} 已完成
        </span>
      </div>
      <div className="detail-card-body">
        <div className="timeline">
          {visibleSteps.map((step, idx) => {
            const isCurrent = step.id === currentStepId || (!currentStepId && step.status !== 'done' && (idx === 0 || visibleSteps[idx - 1]?.status === 'done'))
            const isLast = idx === visibleSteps.length - 1
            return (
              <div
                key={step.id}
                className={cn(
                  'timeline-item cursor-pointer transition-colors',
                  step.status === 'done' && 'completed',
                  isCurrent && 'active',
                  step.status === 'overdue' && 'danger'
                )}
                onClick={() => onStepClick?.(step)}
              >
                <div className={cn('timeline-dot', statusClasses[step.status] || 'muted', isCurrent && 'ring-2 ring-accent ring-offset-1')} />
                {!isLast && <div className="timeline-line" />}
                <div className="timeline-content">
                  <div className="flex items-center gap-2">
                    <span className={cn('badge-pill text-[10px] px-1.5 py-0.5', statusClasses[step.status] || 'muted')}>
                      <span className="inline-flex items-center gap-1">
                        {typeIcons[step.step_type]}
                        {typeLabels[step.step_type]}
                      </span>
                    </span>
                    <span className="timeline-title">{step.title || `步骤 ${step.step_order}`}</span>
                    {isCurrent && <span className="text-[10px] text-accent font-medium">当前</span>}
                  </div>
                  <div className="timeline-time">
                    {step.started_at && `开始：${step.started_at}`}
                    {step.completed_at && ` · 完成：${step.completed_at}`}
                    {step.stay_duration > 0 && ` · 停留：${formatDuration(step.stay_duration)}`}
                  </div>
                  {step.description && <div className="timeline-desc">{step.description}</div>}
                  {step.handler && (
                    <div className="text-[11px] text-muted mt-1">
                      处理人：{step.handler}
                    </div>
                  )}
                  {step.resultData?.message && (
                    <div className="text-[11px] text-success mt-1">
                      结果：{String(step.resultData.message)}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
