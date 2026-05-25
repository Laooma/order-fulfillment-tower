import { useNavigate } from 'react-router-dom'
import { getAnalysisTaskId, cn } from '../lib/utils'
import type { MetaPanelConfig } from '../types/metaConfig'
import { defaultMetaConfig } from '../configs/taskMetaConfigs'

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
  metaConfig?: MetaPanelConfig
}

export default function TaskDetailLayout({ title, children, taskId, contractId, task, metaConfig }: TaskDetailLayoutProps) {
  const navigate = useNavigate()
  const analysisTaskId = taskId ? getAnalysisTaskId(taskId) : ''
  const config = metaConfig || defaultMetaConfig

  // Merge computed fields into the task-like lookup object
  const enriched: Record<string, any> = { ...(task || {}), analysisTaskId }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top header bar */}
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
        {/* Left Meta Panel — rendered from JSON config */}
        <aside className="left-meta">
          <div className="meta-header">
            {config.statusBadges && config.statusBadges.length > 0 && (
              <div className="meta-status-row">
                {config.statusBadges.map((b, i) => (
                  <span key={i} className={`meta-status ${b.className}`}>{b.label}</span>
                ))}
              </div>
            )}
            <div className="meta-id">
              {config.contractIdDataKey && enriched[config.contractIdDataKey]
                ? enriched[config.contractIdDataKey]
                : 'SCJD20241114-K01'}
            </div>
            {config.companyName && (
              <div className="meta-company">{config.companyName}</div>
            )}
          </div>

          {config.sections.map((section, si) => (
            <div key={si} className="meta-section">
              <div className="meta-section-title">{section.title}</div>
              {section.rows.map((row, ri) => {
                // Divider row
                if (row.dividerBefore) {
                  return <div key={ri} className="meta-section-divider" />
                }
                // Resolve value: dataKey first, static fallback, then '—'
                let text = '—'
                if (row.value.dataKey && enriched[row.value.dataKey] != null && enriched[row.value.dataKey] !== '') {
                  text = String(enriched[row.value.dataKey])
                } else if (row.value.static != null) {
                  text = row.value.static
                }

                const valueClass = cn(
                  'meta-value',
                  row.value.mono && 'mono',
                  row.value.bold && 'meta-value-bold',
                )

                return (
                  <div key={ri}>
                    <div className="meta-row">
                      <span className="meta-label">{row.label}</span>
                      <span
                        className={valueClass}
                        style={{ fontSize: row.value.fontSize }}
                        title={text}
                      >
                        {text}
                      </span>
                    </div>
                    {row.progressValue != null && (
                      <div className="meta-progress-bar">
                        <div
                          className="meta-progress-fill"
                          style={{ width: `${row.progressValue}%` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
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
