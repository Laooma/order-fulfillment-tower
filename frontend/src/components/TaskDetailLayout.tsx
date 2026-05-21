import { useNavigate } from 'react-router-dom'
import { getAnalysisTaskId } from '../lib/utils'

interface TaskInfo {
  id?: string
  typeLabel?: string
  assignee?: string
  supervisor?: string
  priorityLabel?: string
  statusLabel?: string
  dueDate?: string
  description?: string
}

interface TaskDetailLayoutProps {
  title: string
  children: React.ReactNode
  taskId?: string
  contractId?: string
  task?: TaskInfo | null
}

export default function TaskDetailLayout({ title, children, taskId, contractId, task }: TaskDetailLayoutProps) {
  const navigate = useNavigate()
  const analysisTaskId = taskId ? getAnalysisTaskId(taskId) : ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top header bar — clean: back button + title + actions */}
      <div className="detail-header-bar">
        <div className="detail-header-left">
          <button onClick={() => navigate('/tasks')} className="detail-back-btn">
            ← 返回任务列表
          </button>
          <span className="detail-header-title">{title}</span>
        </div>
        <div className="detail-header-actions">
          <button className="btn btn-outline">转交</button>
          <button className="btn btn-accent">标记完成</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Meta Panel */}
        <aside className="left-meta">
          <div className="meta-header">
            <div className="meta-status-row">
              <span className="meta-status danger">异常</span>
              <span className="meta-status warn">紧急</span>
            </div>
            <div className="meta-id">{contractId || 'SCJD20241114-K01'}</div>
            <div className="meta-company">中国铁制股份有限公司 · 华北大区 / 安徽</div>
          </div>

          {/* Task info section with IDs */}
          {task && (
            <div className="meta-section">
              <div className="meta-section-title">任务信息</div>
              {taskId && (
                <div className="meta-row">
                  <span className="meta-label">任务编号</span>
                  <span className="meta-value mono" style={{ fontSize: 11 }}>{taskId}</span>
                </div>
              )}
              {analysisTaskId && (
                <div className="meta-row">
                  <span className="meta-label">关联分析</span>
                  <span className="meta-value mono">{analysisTaskId}</span>
                </div>
              )}
              <div className="meta-row">
                <span className="meta-label">任务类型</span>
                <span className="meta-value">{task.typeLabel || '—'}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">优先级</span>
                <span className="meta-value">{task.priorityLabel || '—'}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">状态</span>
                <span className="meta-value">{task.statusLabel || '—'}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">截止日期</span>
                <span className="meta-value mono">{task.dueDate || '—'}</span>
              </div>
              <div className="meta-section-divider" />
              <div className="meta-row">
                <span className="meta-label">督办人</span>
                <span className="meta-value" style={{ fontWeight: 600 }}>{task.supervisor || '—'}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">执行人</span>
                <span className="meta-value" style={{ fontWeight: 600 }}>{task.assignee || '—'}</span>
              </div>
            </div>
          )}

          <div className="meta-section">
            <div className="meta-section-title">基本信息</div>
            <div className="meta-row">
              <span className="meta-label">合同金额</span>
              <span className="meta-value mono">1,558.00 万元</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">下单日期</span>
              <span className="meta-value">2024/11/14</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">交货期</span>
              <span className="meta-value">47 天</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">销售员</span>
              <span className="meta-value">李明</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">采购员</span>
              <span className="meta-value">王芳</span>
            </div>
          </div>

          <div className="meta-section">
            <div className="meta-section-title">履约进度</div>
            <div className="meta-row">
              <span className="meta-label">发货比例</span>
              <span className="meta-value mono">65%</span>
            </div>
            <div className="meta-progress-bar">
              <div className="meta-progress-fill" style={{ width: '65%' }} />
            </div>
            <div className="meta-row" style={{ marginTop: '10px' }}>
              <span className="meta-label">签收比例</span>
              <span className="meta-value mono">32%</span>
            </div>
            <div className="meta-progress-bar">
              <div className="meta-progress-fill" style={{ width: '32%' }} />
            </div>
          </div>

          <div className="meta-section">
            <div className="meta-section-title">产品信息</div>
            <div className="meta-row">
              <span className="meta-label">产品型号</span>
              <span className="meta-value">CCU-2000</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">物料编号</span>
              <span className="meta-value mono">HT001241</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">SKU 数量</span>
              <span className="meta-value mono">6</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">发货方式</span>
              <span className="meta-value">直发客户</span>
            </div>
          </div>
        </aside>

        {/* Center Content */}
        <div className="center-detail">
          <div className="detail-body">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
