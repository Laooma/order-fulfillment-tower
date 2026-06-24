import { useState } from 'react'
import { Bot, Hand, Scale, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ExecutionStep } from '../types'

interface ExecutionTimelineProps {
  steps: ExecutionStep[]
  currentStepId?: string
  onStepClick?: (step: ExecutionStep) => void
}

const typeIcons: Record<string, React.ReactNode> = {
  agent: <Bot size={13} />,
  manual: <Hand size={13} />,
  decision: <Scale size={13} />,
}

const typeLabels: Record<string, string> = {
  agent: 'Agent',
  manual: '手工',
  decision: '决策',
}

function formatDuration(seconds?: number) {
  if (!seconds) return ''
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分`
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`
}

export default function ExecutionTimeline({ steps, currentStepId, onStepClick }: ExecutionTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  // Only show completed steps + current (first non-done) step
  const firstPendingIdx = steps.findIndex((s) => s.status !== 'done')
  const visibleSteps = firstPendingIdx === -1 ? steps : steps.slice(0, firstPendingIdx + 1)
  const doneCount = steps.filter((s) => s.status === 'done').length

  const toggleExpand = (stepId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

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
            const isCurrent =
              step.id === currentStepId ||
              (!currentStepId && step.status !== 'done' && (idx === 0 || visibleSteps[idx - 1]?.status === 'done'))
            const isDone = step.status === 'done'
            const isExpanded = expandedSteps.has(step.id)

            // ── Completed (collapsible) ──
            if (isDone) {
              return (
                <div
                  key={step.id}
                  className={cn('timeline-item completed', isExpanded && 'expanded')}
                  onClick={() => onStepClick?.(step)}
                >
                  <div className={cn('timeline-dot')} />

                  {!isExpanded ? (
                    /* Collapsed: single row */
                    <>
                      <div className="timeline-collapsed-row">
                        <span className={cn('badge-pill success text-[10px] px-1.5 py-0.5')}>
                          {typeIcons[step.step_type]}
                          <span className="ml-1">{typeLabels[step.step_type]}</span>
                        </span>
                        <span className="timeline-collapsed-title">{step.title || `步骤 ${step.step_order}`}</span>
                        {step.handler && (
                          <span className="timeline-collapsed-meta">{step.handler}</span>
                        )}
                        {step.completed_at && (
                          <span className="timeline-collapsed-meta">{step.completed_at}</span>
                        )}
                        <button
                          className="timeline-expand-arrow"
                          onClick={(e) => toggleExpand(step.id, e)}
                          title="展开详情"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Expanded: full details */
                    <div className="timeline-content">
                      <div className="flex items-center gap-2">
                        <span className={cn('badge-pill success text-[10px] px-1.5 py-0.5')}>
                          {typeIcons[step.step_type]}
                          <span className="ml-1">{typeLabels[step.step_type]}</span>
                        </span>
                        <span className="timeline-title">{step.title || `步骤 ${step.step_order}`}</span>
                        <button
                          className="timeline-expand-arrow"
                          onClick={(e) => toggleExpand(step.id, e)}
                          title="收起"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>

                      <div className="timeline-expanded-detail">
                        {step.description && (
                          <div className="timeline-detail-row">
                            <span className="timeline-detail-label">描述：</span>
                            <span className="timeline-detail-value">{step.description}</span>
                          </div>
                        )}
                        {step.handler && (
                          <div className="timeline-detail-row">
                            <span className="timeline-detail-label">处理人：</span>
                            <span className="timeline-detail-value">{step.handler}</span>
                          </div>
                        )}
                        {step.started_at && (
                          <div className="timeline-detail-row">
                            <span className="timeline-detail-label">开始：</span>
                            <span className="timeline-detail-value">{step.started_at}</span>
                          </div>
                        )}
                        {step.completed_at && (
                          <div className="timeline-detail-row">
                            <span className="timeline-detail-label">完成：</span>
                            <span className="timeline-detail-value">{step.completed_at}</span>
                          </div>
                        )}
                        {step.stay_duration > 0 && (
                          <div className="timeline-detail-row">
                            <span className="timeline-detail-label">停留：</span>
                            <span className="timeline-detail-value">{formatDuration(step.stay_duration)}</span>
                          </div>
                        )}
                        {step.resultData?.message && (
                          <div className="timeline-detail-row">
                            <span className="timeline-detail-label">操作内容：</span>
                            <span className="timeline-detail-value">{String(step.resultData.message)}</span>
                          </div>
                        )}
                        {step.resultData?.notes && (
                          <div className="timeline-notes-box">
                            <div className="timeline-detail-label" style={{ marginBottom: 2 }}>📝 备注：</div>
                            {String(step.resultData.notes)}
                          </div>
                        )}
                        {step.resultData?.autoCompleted && (
                          <div className="timeline-detail-row">
                            <span className="badge-pill info text-[10px]">⚡ 自动完成 — {String(step.resultData.reason || '执行人与任务待办人相同')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            }

            // ── Current step (highlighted) ──
            return (
              <div
                key={step.id}
                className={cn(
                  'timeline-item current',
                  step.status === 'overdue' && 'danger'
                )}
                onClick={() => onStepClick?.(step)}
              >
                <div className={cn('timeline-dot')} />
                <div className="timeline-content">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'badge-pill text-[10px] px-1.5 py-0.5',
                      step.status === 'overdue' ? 'danger' : 'progress'
                    )}>
                      {typeIcons[step.step_type]}
                      <span className="ml-1">{typeLabels[step.step_type]}</span>
                    </span>
                    <span className="timeline-title">{step.title || `步骤 ${step.step_order}`}</span>
                    <span className="timeline-current-badge">当前</span>
                  </div>
                  <div className="timeline-time">
                    {step.started_at && `开始：${step.started_at}`}
                    {step.stay_duration > 0 && ` · 停留：${formatDuration(step.stay_duration)}`}
                  </div>
                  {step.description && <div className="timeline-desc">{step.description}</div>}
                  {step.handler && (
                    <div className="text-[11px] text-muted mt-1">处理人：{step.handler}</div>
                  )}
                  {step.assignee && (
                    <div className="text-[11px] text-muted mt-0.5">待办人：{step.assignee}</div>
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
