import { useState } from 'react'
import { X, ArrowRightLeft } from 'lucide-react'
import { api } from '../lib/api'

interface TaskHandoverModalProps {
  taskId: string
  currentAssignee: string
  currentUserName?: string
  onClose: () => void
  onHandovered?: () => void
}

export default function TaskHandoverModal({ taskId, currentAssignee, currentUserName, onClose, onHandovered }: TaskHandoverModalProps) {
  const [toUser, setToUser] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!toUser.trim()) {
      setError('请输入移交对象')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.executionTasks.handover(taskId, {
        fromUser: currentAssignee,
        toUser: toUser.trim(),
        reason: reason.trim(),
        handedBy: currentUserName,
      })
      onHandovered?.()
      onClose()
    } catch (err: any) {
      setError(err.message || '移交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ArrowRightLeft size={16} />
            任务移交
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="text-xs text-muted">
            当前待办人：<span className="text-fg font-medium">{currentAssignee}</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted">移交给</label>
            <input
              type="text"
              value={toUser}
              onChange={(e) => setToUser(e.target.value)}
              placeholder="请输入接收人姓名"
              className="manual-form-input w-full"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted">移交原因</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="可选，说明移交原因..."
              className="decision-form-textarea w-full"
              rows={3}
            />
          </div>

          {error && <div className="text-xs text-danger bg-danger/10 px-3 py-2 rounded">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-outline" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-accent" disabled={loading}>
              {loading ? '移交中...' : '确认移交'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
