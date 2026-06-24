import { useEffect, useState } from 'react'
import { Bot, Hand, Scale, CheckCircle, Play, Send, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { api } from '../lib/api'
import type { ExecutionStep, ExecutionTask, DecisionOption } from '../types'

interface CurrentStepPanelProps {
  task: ExecutionTask
  step: ExecutionStep
  currentUserName?: string
  onStepUpdated?: () => void
}

const typeIcons: Record<string, React.ReactNode> = {
  agent: <Bot size={18} />,
  manual: <Hand size={18} />,
  decision: <Scale size={18} />,
}

const typeLabels: Record<string, string> = {
  agent: 'Agent 执行步骤',
  manual: '手工执行步骤',
  decision: '决策步骤',
}

const statusClasses: Record<string, string> = {
  done: 'success',
  progress: 'accent',
  overdue: 'danger',
  pending: 'muted',
}

export default function CurrentStepPanel({ task, step, currentUserName, onStepUpdated }: CurrentStepPanelProps) {
  const [options, setOptions] = useState<DecisionOption[]>([])
  const [selectedOption, setSelectedOption] = useState<string>('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultMessage, setResultMessage] = useState('')

  const canOperate = !currentUserName || currentUserName === task.assignee || currentUserName === task.supervisor

  useEffect(() => {
    if (step.step_type === 'decision') {
      api.executionTasks.options(step.id)
        .then((res) => {
          setOptions(res.data)
          const selected = res.data.find((o) => o.is_selected)
          if (selected) setSelectedOption(selected.id)
        })
        .catch(() => setOptions([]))
    }
  }, [step])

  const handleCompleteManual = async () => {
    setLoading(true)
    try {
      await api.executionTasks.completeStep(step.id, {
        resultData: { message: comment || '手工步骤已完成', completedBy: currentUserName },
      })
      setResultMessage('步骤已完成')
      onStepUpdated?.()
    } catch (err: any) {
      setResultMessage(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExecuteAgent = async () => {
    setLoading(true)
    try {
      await api.executionTasks.executeStep(step.id, { handler: currentUserName || 'Agent' })
      setResultMessage('Agent 步骤已开始执行')
      onStepUpdated?.()
    } catch (err: any) {
      setResultMessage(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDecide = async () => {
    if (!selectedOption) {
      setResultMessage('请选择决策项')
      return
    }
    setLoading(true)
    try {
      await api.executionTasks.decide(step.id, {
        optionId: selectedOption,
        comment,
        handler: currentUserName,
      })
      setResultMessage('决策已提交')
      onStepUpdated?.()
    } catch (err: any) {
      setResultMessage(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const isDone = step.status === 'done'

  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center justify-center w-7 h-7 rounded-full text-white', `bg-${statusClasses[step.status] || 'muted'}`)}>
            {typeIcons[step.step_type]}
          </span>
          <span className="detail-card-title">当前步骤：{typeLabels[step.step_type]}</span>
        </div>
        <span className={cn('badge-pill', statusClasses[step.status] || 'muted')}>
          {step.statusLabel || step.status}
        </span>
      </div>

      <div className="detail-card-body space-y-4">
        <div className="bg-surface rounded-lg p-4 border border-border">
          <div className="text-sm font-medium mb-1">{step.title || `步骤 ${step.step_order}`}</div>
          {step.description && <div className="text-xs text-muted leading-relaxed">{step.description}</div>}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            <div>待办人：<span className="text-fg">{task.assignee}</span></div>
            <div>督办人：<span className="text-fg">{task.supervisor || '—'}</span></div>
            {step.handler && <div>处理人：<span className="text-fg">{step.handler}</span></div>}
          </div>
        </div>

        {!canOperate && !isDone && (
          <div className="text-xs text-warning bg-warning/10 px-3 py-2 rounded">
            只有待办人或督办人可以操作当前步骤
          </div>
        )}

        {isDone ? (
          <div className="flex items-center gap-2 text-success text-sm">
            <CheckCircle size={16} />
            该步骤已完成
            {step.completed_at && <span className="text-muted">（{step.completed_at}）</span>}
          </div>
        ) : (
          <>
            {step.step_type === 'manual' && (
              <div className="space-y-3">
                <label className="block text-xs text-muted">处理备注</label>
                <textarea
                  className="decision-form-textarea"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="请输入处理结果或备注..."
                />
                <button
                  className="btn btn-accent inline-flex items-center gap-1.5"
                  disabled={loading || !canOperate}
                  onClick={handleCompleteManual}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  确认完成
                </button>
              </div>
            )}

            {step.step_type === 'agent' && (
              <div className="space-y-3">
                <div className="text-xs text-muted">点击后系统将触发 Agent 执行该步骤，执行结果会同步记录到时间轴。</div>
                <button
                  className="btn btn-primary inline-flex items-center gap-1.5"
                  disabled={loading || !canOperate}
                  onClick={handleExecuteAgent}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  执行 Agent 任务
                </button>
              </div>
            )}

            {step.step_type === 'decision' && (
              <div className="space-y-3">
                {options.length > 0 && (
                  <div className="space-y-2">
                    {options.map((opt) => (
                      <label
                        key={opt.id}
                        className={cn(
                          'flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors',
                          selectedOption === opt.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface'
                        )}
                      >
                        <input
                          type="radio"
                          name="decision-option"
                          value={opt.id}
                          checked={selectedOption === opt.id}
                          onChange={() => setSelectedOption(opt.id)}
                          disabled={!canOperate}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium">{opt.title}</div>
                          {opt.description && <div className="text-xs text-muted mt-0.5">{opt.description}</div>}
                          <div className="flex gap-3 mt-1.5 text-[11px] text-muted">
                            {opt.estimated_duration && <span>预计耗时：{opt.estimated_duration}</span>}
                            {opt.risk_level && <span>风险：{opt.risk_level}</span>}
                            {opt.cost_estimate && <span>成本：{opt.cost_estimate}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                <label className="block text-xs text-muted">决策意见</label>
                <textarea
                  className="decision-form-textarea"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="请输入决策意见..."
                  disabled={!canOperate}
                />

                <button
                  className="btn btn-success inline-flex items-center gap-1.5"
                  disabled={loading || !canOperate}
                  onClick={handleDecide}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  提交决策
                </button>
              </div>
            )}
          </>
        )}

        {resultMessage && (
          <div className={cn(
            'text-xs px-3 py-2 rounded',
            resultMessage.includes('失败') || resultMessage.includes('请') ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
          )}>
            {resultMessage}
          </div>
        )}
      </div>
    </div>
  )
}
