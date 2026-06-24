import { useEffect, useState } from 'react'
import { Bot, Hand, Scale, CheckCircle, Play, Send, AlertTriangle, Clock, DollarSign, Shield } from 'lucide-react'
import { cn } from '../lib/utils'
import { api } from '../lib/api'
import type { ExecutionTask, ExecutionStep, DecisionOption } from '../types'

interface CurrentStepPanelProps {
  task: ExecutionTask
  step: ExecutionStep
  currentUserName?: string
  onStepUpdated?: () => void
}

const typeIcons: Record<string, React.ReactNode> = {
  agent: <Bot size={16} />,
  manual: <Hand size={16} />,
  decision: <Scale size={16} />,
}

const typeLabels: Record<string, string> = {
  agent: 'Agent 执行步骤',
  manual: '手工执行步骤',
  decision: '决策步骤',
}

export default function CurrentStepPanel({ task, step, currentUserName, onStepUpdated }: CurrentStepPanelProps) {
  const [options, setOptions] = useState<DecisionOption[]>([])
  const [selectedOption, setSelectedOption] = useState('')
  const [comment, setComment] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultMessage, setResultMessage] = useState('')

  const isDone = step.status === 'done'
  const canOperate = currentUserName && (
    currentUserName === task.assignee ||
    currentUserName === task.supervisor
  )

  // Load decision options
  useEffect(() => {
    if (step.step_type === 'decision' && step.id) {
      api.executionTasks.options(step.id).then((res) => {
        setOptions(res.data || [])
        const preselected = (res.data || []).find((o: DecisionOption) => o.is_selected)
        if (preselected) setSelectedOption(preselected.id)
      }).catch(() => {})
    }
  }, [step.id, step.step_type])

  const handleCompleteManual = async () => {
    if (!canOperate) return
    setLoading(true)
    setResultMessage('')
    try {
      await api.executionTasks.completeStep(step.id, {
        resultData: {
          message: comment || '手工确认完成',
          completedBy: currentUserName,
          notes: notes || undefined,
        },
      })
      setResultMessage('步骤已完成 ✅')
      setTimeout(() => onStepUpdated?.(), 600)
    } catch (err: any) {
      setResultMessage(err?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handleExecuteAgent = async () => {
    if (!canOperate) return
    setLoading(true)
    setResultMessage('')
    try {
      await api.executionTasks.executeStep(step.id, {
        handler: currentUserName || 'Agent',
      })
      // If notes provided, store them via a separate update
      if (notes) {
        await api.executionTasks.completeStep(step.id, {
          resultData: {
            message: 'Agent 执行完成',
            completedBy: currentUserName,
            notes,
          },
        })
      }
      setResultMessage('Agent 任务已触发，结果将同步到时间轴 ✅')
      setTimeout(() => onStepUpdated?.(), 1000)
    } catch (err: any) {
      setResultMessage(err?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handleDecide = async () => {
    if (!canOperate || !selectedOption) return
    setLoading(true)
    setResultMessage('')
    try {
      const chosen = options.find((o) => o.id === selectedOption)
      await api.executionTasks.decide(step.id, {
        optionId: selectedOption,
        comment: comment || chosen?.title || '',
        handler: currentUserName,
        resultData: {
          decisionOptionId: selectedOption,
          decisionTitle: chosen?.title || '',
          comment,
          notes: notes || undefined,
        },
      })
      setResultMessage('决策已提交 ✅')
      setTimeout(() => onStepUpdated?.(), 600)
    } catch (err: any) {
      setResultMessage(err?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const statusBadgeClass = isDone ? 'success' : step.status === 'overdue' ? 'danger' : step.status === 'progress' ? 'progress' : 'muted'

  return (
    <div className="detail-card">
      {/* Header */}
      <div className="detail-card-header">
        <div className="flex items-center gap-2">
          <span className={cn('w-7 h-7 rounded-full flex items-center justify-center',
            isDone ? 'bg-success/10 text-success' :
            step.status === 'overdue' ? 'bg-danger/10 text-danger' :
            'bg-accent/10 text-accent'
          )}>
            {typeIcons[step.step_type]}
          </span>
          <span className="detail-card-title">
            {isDone ? '已完成' : typeLabels[step.step_type]}
          </span>
        </div>
        <span className={cn('badge-pill text-[10px]', statusBadgeClass)}>
          {step.statusLabel || step.status}
        </span>
      </div>

      <div className="detail-card-body">
        {/* Step info */}
        <div className="mb-4 p-3 rounded-md bg-neutral-bg">
          <div className="text-sm font-semibold text-fg mb-1">{step.title}</div>
          {step.description && (
            <div className="text-xs text-muted leading-relaxed">{step.description}</div>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted">
            <span>待办人：{task.assignee}</span>
            <span>督办人：{task.supervisor || '—'}</span>
            {step.handler && <span>处理人：{step.handler}</span>}
          </div>
        </div>

        {/* Not authorized */}
        {!canOperate && !isDone && (
          <div className="flex items-center gap-2 text-xs text-warning mb-4 p-2 rounded bg-warning/5 border border-warning/20">
            <AlertTriangle size={14} />
            只有待办人或督办人可以操作当前步骤
          </div>
        )}

        {/* Done state */}
        {isDone && (
          <div className="flex flex-col items-center gap-2 py-4">
            <CheckCircle size={36} className="text-success" />
            <span className="text-sm font-semibold text-success">该步骤已完成</span>
            {step.completed_at && (
              <span className="text-xs text-muted">完成时间：{step.completed_at}</span>
            )}
          </div>
        )}

        {/* ── Manual step ── */}
        {!isDone && step.step_type === 'manual' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="step-notes-label">处理备注</div>
              <textarea
                className="step-notes-field"
                placeholder="请输入处理结果或备注..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={loading || !canOperate}
              />
            </div>
            <div>
              <div className="step-notes-label">留存备注（可选）</div>
              <textarea
                className="step-notes-field"
                placeholder="输入备注信息，用于后续查阅..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={loading || !canOperate}
              />
            </div>
            <button
              className="btn btn-accent w-full justify-center"
              onClick={handleCompleteManual}
              disabled={loading || !canOperate}
            >
              <CheckCircle size={14} />
              确认完成
            </button>
          </div>
        )}

        {/* ── Agent step ── */}
        {!isDone && step.step_type === 'agent' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs text-muted leading-relaxed p-3 rounded bg-accent/5 border border-accent/10">
              点击后系统将触发 Agent 执行该步骤，执行结果会同步记录到时间轴。
            </div>
            <div>
              <div className="step-notes-label">留存备注（可选）</div>
              <textarea
                className="step-notes-field"
                placeholder="输入备注信息，用于后续查阅..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={loading || !canOperate}
              />
            </div>
            <button
              className="btn btn-primary w-full justify-center"
              onClick={handleExecuteAgent}
              disabled={loading || !canOperate}
            >
              <Play size={14} />
              执行 Agent 任务
            </button>
          </div>
        )}

        {/* ── Decision step (redesigned) ── */}
        {!isDone && step.step_type === 'decision' && (
          <div className="flex flex-col gap-4">
            {options.length > 0 ? (
              <>
                <div>
                  <div className="text-xs font-semibold text-fg mb-2">请选择决策方案：</div>
                  <div className="decision-options-list">
                    {options.map((opt) => (
                      <div
                        key={opt.id}
                        className={cn(
                          'decision-option-card',
                          selectedOption === opt.id && 'selected'
                        )}
                        onClick={() => !loading && canOperate && setSelectedOption(opt.id)}
                      >
                        <div className="decision-option-radio">
                          {selectedOption === opt.id ? '✓' : ''}
                        </div>
                        <div className="decision-option-body">
                          <div className="decision-option-title">{opt.title}</div>
                          {opt.description && (
                            <div className="decision-option-desc">{opt.description}</div>
                          )}
                          {(opt.estimated_duration || opt.risk_level || opt.cost_estimate) && (
                            <div className="decision-option-meta">
                              {opt.estimated_duration && (
                                <span><Clock size={11} /> {opt.estimated_duration}</span>
                              )}
                              {opt.risk_level && (
                                <span><Shield size={11} /> {opt.risk_level}</span>
                              )}
                              {opt.cost_estimate && (
                                <span><DollarSign size={11} /> {opt.cost_estimate}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="step-notes-label">补充说明（可选）</div>
                  <textarea
                    className="step-notes-field"
                    placeholder="对决策方案的补充说明..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    disabled={loading || !canOperate}
                  />
                </div>

                <div>
                  <div className="step-notes-label">留存备注（可选）</div>
                  <textarea
                    className="step-notes-field"
                    placeholder="输入备注信息，用于后续查阅..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={loading || !canOperate}
                  />
                </div>

                <button
                  className="btn btn-accent w-full justify-center"
                  onClick={handleDecide}
                  disabled={loading || !canOperate || !selectedOption}
                >
                  <Send size={14} />
                  确认决策{selectedOption ? ` — ${(options.find(o => o.id === selectedOption)?.title || '').slice(0, 15)}` : ''}
                </button>
              </>
            ) : (
              <div className="text-center text-muted text-xs py-6">暂无决策选项</div>
            )}
          </div>
        )}

        {/* Result message */}
        {resultMessage && (
          <div className={cn(
            'mt-3 p-3 rounded text-xs font-medium',
            resultMessage.includes('失败') || resultMessage.includes('请')
              ? 'bg-danger/10 text-danger'
              : 'bg-success/10 text-success'
          )}>
            {resultMessage}
          </div>
        )}
      </div>
    </div>
  )
}
