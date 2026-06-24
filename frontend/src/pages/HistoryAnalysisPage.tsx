import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../lib/utils'
import SubNav from '../components/SubNav'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'

/* ── Types ── */
interface HistoryTask {
  id: string
  title: string
  description: string
  agent: string
  initiator: string
  status: string
  createdAt: string
  completedAt: string
  relatedContracts: string[]
  skillId?: string
  skillName?: string
}

/* ── API Data ── */
let allTasks: HistoryTask[] = []

/* ── Helpers ── */
const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    analyzing: '分析中',
    analyzed: '已分析',
    todos_generated: '待办已生成',
    completed: '已完成',
  }
  return map[status] || status
}

const statusBadgeClass = (status: string) => {
  switch (status) {
    case 'completed':
    case '已完成': return 'badge-pill badge-success'
    case 'analyzing':
    case '处理中': return 'badge-pill badge-info'
    case 'todos_generated': return 'badge-pill badge-warning'
    case 'analyzed': return 'badge-pill badge-info'
    case '待处理': return 'badge-pill badge-warning'
    case '审批中': return 'badge-pill badge-info'
    case '已驳回': return 'badge-pill badge-danger'
    default: return 'badge-pill badge-neutral'
  }
}

const agentIconClass = (agent: string) => {
  if (agent.includes('系统')) return 'agent-icon agent-blue'
  if (agent.includes('运营')) return 'agent-icon agent-green'
  if (agent.includes('仓储')) return 'agent-icon agent-orange'
  if (agent.includes('风控')) return 'agent-icon agent-purple'
  return 'agent-icon agent-blue'
}

const agentShort = (agent: string) => {
  if (agent.includes('系统')) return '系'
  if (agent.includes('运营')) return '运'
  if (agent.includes('仓储')) return '仓'
  if (agent.includes('风控')) return '风'
  return agent.charAt(0)
}

/* ── List View ── */
function ListView() {
  const navigate = useNavigate()
  const emptyFilters = { taskId: '', timeRange: '', status: '', contractId: '' }
  const [filters, setFilters] = useState(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filtered = useMemo(() => {
    let tasks = [...allTasks]
    if (appliedFilters.taskId) tasks = tasks.filter((t) => t.id.toLowerCase().includes(appliedFilters.taskId.toLowerCase()))
    if (appliedFilters.status) tasks = tasks.filter((t) => t.status === appliedFilters.status)
    if (appliedFilters.contractId) {
      tasks = tasks.filter((t) => t.relatedContracts.some((c) => c.toLowerCase().includes(appliedFilters.contractId.toLowerCase())))
    }
    if (appliedFilters.timeRange) {
      const now = new Date()
      tasks = tasks.filter((t) => {
        const taskDate = new Date(t.createdAt.replace(/\//g, '-'))
        const diffDays = (now.getTime() - taskDate.getTime()) / (1000 * 60 * 60 * 24)
        if (appliedFilters.timeRange === 'today') return diffDays <= 1
        if (appliedFilters.timeRange === 'week') return diffDays <= 7
        if (appliedFilters.timeRange === 'month') return diffDays <= 30
        return true
      })
    }
    if (sortCol) {
      tasks.sort((a, b) => {
        const av = (a[sortCol as keyof HistoryTask] || '').toString().toLowerCase()
        const bv = (b[sortCol as keyof HistoryTask] || '').toString().toLowerCase()
        if (av < bv) return sortDir === 'asc' ? -1 : 1
        if (av > bv) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }
    return tasks
  }, [appliedFilters, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const start = (currentPage - 1) * pageSize
  const pageItems = filtered.slice(start, start + pageSize)

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
    setCurrentPage(1)
  }

  const updateFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleSearch = () => {
    setAppliedFilters({ ...filters })
    setCurrentPage(1)
  }

  const handleReset = () => {
    setFilters({ ...emptyFilters })
    setAppliedFilters({ ...emptyFilters })
    setCurrentPage(1)
  }

  const viewTask = (task: HistoryTask) => {
    navigate(`/analysis/${task.id}`)
  }

  const sortClass = (col: string) => {
    if (sortCol !== col) return 'sortable'
    return `sortable ${sortDir}`
  }

  const sortArrow = (col: string) => {
    if (sortCol !== col) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filter Panel */}
      <div className="filter-panel">
        <div className="filter-row">
          <div className="filter-group">
            <div className="filter-item" style={{ flex: 1.2 }}>
              <span className="filter-item-label">分析任务编号</span>
              <input
                type="text"
                className="filter-input"
                placeholder="请输入"
                value={filters.taskId}
                onChange={(e) => updateFilter('taskId', e.target.value)}
              />
            </div>
            <div className="filter-item">
              <span className="filter-item-label">发起时间</span>
              <select
                className="filter-select"
                value={filters.timeRange}
                onChange={(e) => updateFilter('timeRange', e.target.value)}
              >
                <option value="">—请选择—</option>
                <option value="today">今天</option>
                <option value="week">近7天</option>
                <option value="month">近30天</option>
              </select>
            </div>
            <div className="filter-item">
              <span className="filter-item-label">处理状态</span>
              <select
                className="filter-select"
                value={filters.status}
                onChange={(e) => updateFilter('status', e.target.value)}
              >
                <option value="">—请选择—</option>
                <option value="analyzing">分析中</option>
                <option value="analyzed">已分析</option>
                <option value="todos_generated">待办已生成</option>
                <option value="completed">已完成</option>
              </select>
            </div>
            <div className="filter-item" style={{ flex: 1.2 }}>
              <span className="filter-item-label">关联销售合同编号</span>
              <input
                type="text"
                className="filter-input"
                placeholder="请输入"
                value={filters.contractId}
                onChange={(e) => updateFilter('contractId', e.target.value)}
              />
            </div>
          </div>
          <div className="filter-actions">
            <button className="btn btn-ghost" onClick={handleReset}>
              重置
            </button>
            <button className="btn btn-primary" onClick={handleSearch}>
              搜索
            </button>
          </div>
        </div>
      </div>

      {/* Table Toolbar */}
      <div className="table-toolbar">
        <div className="toolbar-left">
          <span className="total-count">
            共 <strong>{filtered.length}</strong> 条分析任务
          </span>
          <div style={{ width: '1px', height: '14px', background: 'var(--color-border)' }} />
          <button className="btn btn-ghost" style={{ height: '26px', fontSize: '11px' }}>
            批量导出
          </button>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-outline" style={{ height: '26px', fontSize: '11px' }}>
            筛选
          </button>
          <button className="btn btn-outline" style={{ height: '26px', fontSize: '11px' }}>
            排序
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '36px', padding: '8px' }}>
                <input type="checkbox" style={{ width: '14px', height: '14px' }} />
              </th>
              <th style={{ width: '36px' }}>#</th>
              <th className={sortClass('id')} style={{ width: '130px' }} onClick={() => handleSort('id')}>
                分析任务编号 <span className="sort-arrow">{sortArrow('id')}</span>
              </th>
              <th className={sortClass('title')} style={{ width: '140px' }} onClick={() => handleSort('title')}>
                分析主题 <span className="sort-arrow">{sortArrow('title')}</span>
              </th>
              <th style={{ width: '240px' }}>详细说明</th>
              <th style={{ width: '100px' }}>发起Agent</th>
              <th style={{ width: '90px' }}>相关skill</th>
              <th style={{ width: '70px' }}>发起人</th>
              <th className={sortClass('status')} style={{ width: '80px' }} onClick={() => handleSort('status')}>
                处理状态 <span className="sort-arrow">{sortArrow('status')}</span>
              </th>
              <th className={sortClass('createdAt')} style={{ width: '110px' }} onClick={() => handleSort('createdAt')}>
                发起时间 <span className="sort-arrow">{sortArrow('createdAt')}</span>
              </th>
              <th style={{ width: '110px' }}>处理完成时间</th>
              <th style={{ width: '130px' }}>关联销售合同编号</th>
              <th style={{ width: '90px' }} className="col-sticky-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((t, i) => (
              <tr key={t.id} onClick={() => viewTask(t)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" style={{ width: '14px', height: '14px' }} />
                </td>
                <td style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                  {String(start + i + 1).padStart(2, '0')}
                </td>
                <td>
                  <span
                    className="order-num"
                    onClick={(e) => { e.stopPropagation(); viewTask(t) }}
                  >
                    {t.id}
                  </span>
                </td>
                <td>{t.title}</td>
                <td>
                  <div className="desc-cell" title={t.description}>{t.description}</div>
                </td>
                <td>
                  <span className={agentIconClass(t.agent)}>{agentShort(t.agent)}</span>
                  {t.agent}
                </td>
                <td style={{ fontSize: '12px', color: t.skillName ? 'var(--color-fg)' : 'var(--color-muted)' }}>
                  {t.skillName || '无skill'}
                </td>
                <td>{t.initiator}</td>
                <td>
                  <span className={statusBadgeClass(t.status)}>{statusLabel(t.status)}</span>
                </td>
                <td style={{ fontSize: '11px', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                  {t.createdAt}
                </td>
                <td style={{ fontSize: '11px', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                  {t.completedAt || '—'}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                  {t.relatedContracts.join(', ')}
                </td>
                <td className="col-sticky-right" onClick={(e) => e.stopPropagation()}>
                  <div className="action-btns">
                    <button
                      className="action-btn"
                      title="查看详情"
                      onClick={() => viewTask(t)}
                    >
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M7 2c4 0 6 2.5 6 5s-2 5-6 5-6-2.5-6-5 2-5 6-5zm0 2a3 3 0 100 6 3 3 0 000-6z"/></svg>
                    </button>
                    {(t.status === 'analyzed' || t.status === 'todos_generated') && (
                      <button className="action-btn" title="重新执行">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1a6 6 0 100 12A6 6 0 007 1zm0 2a4 4 0 11-.001 8.001A4 4 0 017 3z"/></svg>
                      </button>
                    )}
                    <button className="action-btn" title="执行日志">
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><path d="M2 3h6v1H2zm0 3h10v1H2zm0 3h8v1H2z"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pagination">
        <div className="pagination-info">
          显示 <span style={{ fontFamily: 'var(--font-mono)' }}>{filtered.length === 0 ? '0–0' : `${start + 1}–${Math.min(start + pageSize, filtered.length)}`}</span> 条，共 <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{filtered.length}</span> 条
        </div>
        <div className="pagination-controls">
          <button
            className="page-btn"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              className={cn('page-btn', currentPage === p && 'active')}
              onClick={() => setCurrentPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            className="page-btn"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            ›
          </button>
          <div style={{ width: '8px' }} />
          <select
            className="page-size-select"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
          >
            <option value={10}>10/页</option>
            <option value={25}>25/页</option>
            <option value={50}>50/页</option>
          </select>
        </div>
      </div>
    </div>
  )
}

/* ── Stats View ── */
function StatsView() {
  const total = allTasks.length
  const analyzing = allTasks.filter((t) => t.status === 'analyzing').length
  const analyzed = allTasks.filter((t) => t.status === 'analyzed').length
  const todosGenerated = allTasks.filter((t) => t.status === 'todos_generated').length
  const completed = allTasks.filter((t) => t.status === 'completed').length

  const overviewData = [
    { label: '总任务数', value: total, color: 'var(--color-accent)' },
    { label: '分析中', value: analyzing, color: 'var(--color-info)' },
    { label: '已分析', value: analyzed, color: 'var(--color-accent)' },
    { label: '待办已生成', value: todosGenerated, color: 'var(--color-warning)' },
    { label: '已完成', value: completed, color: 'var(--color-success)' },
  ]

  const statusCounts: Record<string, number> = {}
  allTasks.forEach((t) => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1 })

  const agentCounts: Record<string, number> = {}
  allTasks.forEach((t) => { agentCounts[t.agent] = (agentCounts[t.agent] || 0) + 1 })

  const trendDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
  const trendCounts = [6, 7, 7, 8, 10, 10, 20]
  const maxTrend = Math.max(...trendCounts, 1)

  const colors = ['var(--color-accent)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-muted)', '#7c3aed', '#ea580c']

  const renderDistribution = (counts: Record<string, number>) => {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const maxCount = Math.max(...entries.map((e) => e[1]), 1)
    return entries.map((e, i) => (
      <div key={e[0]} className="stat-bar-item">
        <span className="stat-bar-label">{e[0]}</span>
        <div className="stat-bar-track">
          <div className="stat-bar-fill" style={{ width: `${(e[1] / maxCount) * 100}%`, background: colors[i % colors.length] }} />
        </div>
        <span className="stat-bar-count">{e[1]}</span>
      </div>
    ))
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Overview Cards */}
      <div className="stats-grid">
        {overviewData.map((d) => (
          <div key={d.label} className="stat-card">
            <div className="stat-card-value">{d.value}</div>
            <div className="stat-card-label">{d.label}</div>
            <div className="stat-card-bar">
              <div className="stat-card-bar-fill" style={{ width: `${total ? (d.value / total) * 100 : 0}%`, background: d.color }} />
            </div>
          </div>
        ))}
      </div>

      {/* Distribution Charts */}
      <div className="stats-row">
        <div className="stats-section">
          <div className="stats-section-header">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ opacity: 0.7 }}><path d="M2 2h10v2H2zM2 6h8v2H2zM2 10h6v2H2z"/></svg>
            按处理状态分布
          </div>
          <div className="stats-section-body">
            <div className="stat-distribution">
              {renderDistribution(statusCounts)}
            </div>
          </div>
        </div>
        <div className="stats-section">
          <div className="stats-section-header">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ opacity: 0.7 }}><path d="M7 1a2 2 0 110 4 2 2 0 010-4zM2 6h10v1a5 5 0 01-10 0V6zM1 13h12v1H1z"/></svg>
            按发起Agent分布
          </div>
          <div className="stats-section-body">
            <div className="stat-distribution">
              {renderDistribution(agentCounts)}
            </div>
          </div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stats-section">
          <div className="stats-section-header">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ opacity: 0.7 }}><path d="M1 1h12v3H1zm0 5h9v3H1zm0 5h6v3H1z"/></svg>
            最近7天趋势
          </div>
          <div className="stats-section-body">
            <div className="stat-distribution">
              {trendDays.map((d, i) => (
                <div key={d} className="stat-bar-item">
                  <span className="stat-bar-label">{d}</span>
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${(trendCounts[i] / maxTrend) * 100}%`, background: 'var(--color-accent)' }} />
                  </div>
                  <span className="stat-bar-count">{trendCounts[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Main Page ── */
export default function HistoryAnalysisPage() {
  const [view, setView] = useState<'list' | 'stats'>('list')
  const [dataReady, setDataReady] = useState(false)
  const hasOperation = useAuthStore((s) => s.hasOperation)
  const canView = hasOperation('view_analysis')

  useEffect(() => {
    api.analysis.list({ pageSize: '100' })
      .then((res) => {
        allTasks = res.data
        setDataReady(true)
      })
      .catch((err) => {
        console.error('Failed to load analysis tasks:', err)
        setDataReady(true)
      })
  }, [])

  if (!canView) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-muted)]">
        无权限访问 — 需要 view_analysis 操作权限
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <SubNav
        items={[
          { key: 'list', label: '分析任务列表' },
          { key: 'stats', label: '分析任务统计' },
        ]}
        activeKey={view}
        onChange={(k) => setView(k as 'list' | 'stats')}
      />
      {!dataReady ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-muted)]">加载中...</div>
      ) : (
        view === 'list' ? <ListView /> : <StatsView />
      )}
    </div>
  )
}
