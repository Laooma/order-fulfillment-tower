import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, X, RefreshCw } from 'lucide-react'
import SubNav from '../components/SubNav'
import DataTable from '../components/common/DataTable'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import type { ExecutionTask, ExecutionTaskStatus, BusinessType, ExecutionPriority } from '../types'
import type { Column } from '../components/common/DataTable'

const subNavKeys = ['all', 'overdue', 'todo', 'done'] as const
const subNavLabels: Record<string, string> = {
  all: '全部任务', overdue: '逾期任务', todo: '待办任务', done: '已完成任务',
}

const priorityOptions = [
  { value: 'high', label: '高优先级', dot: 'var(--color-danger)' },
  { value: 'medium', label: '中优先级', dot: 'var(--color-warning)' },
  { value: 'low', label: '低优先级', dot: 'var(--color-muted)' },
]

const statusOptions = [
  { value: 'pending', label: '待开始', dot: 'var(--color-muted)' },
  { value: 'progress', label: '进行中', dot: 'var(--color-accent)' },
  { value: 'overdue', label: '已逾期', dot: 'var(--color-danger)' },
  { value: 'done', label: '已完成', dot: 'var(--color-success)' },
]

function priorityOrder(p: ExecutionPriority) {
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  return order[p] ?? 99
}

function statusBadgeClass(s: ExecutionTaskStatus) {
  switch (s) {
    case 'progress': return 'progress'
    case 'overdue': return 'danger'
    case 'done': return 'success'
    default: return 'default'
  }
}

function priorityDotClass(p: ExecutionPriority) {
  switch (p) {
    case 'high': return 'high'
    case 'medium': return 'mid'
    case 'low': return 'low'
  }
}

interface FilterGroupProps {
  title: string
  options: { value: string; label: string; dot?: string; count?: number }[]
  activeValue: string
  onChange: (v: string) => void
  showSearch?: boolean
  searchPlaceholder?: string
}

function FilterGroup({ title, options, activeValue, onChange, showSearch, searchPlaceholder }: FilterGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    return options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()) || o.value === 'all')
  }, [options, search])

  return (
    <div className="filter-group">
      <div className="filter-group-title" onClick={() => setCollapsed(!collapsed)}>
        {title}
        <ChevronDown size={10} className={collapsed ? '-rotate-90' : ''} style={{ transition: 'transform 150ms' }} />
      </div>
      {!collapsed && (
        <>
          {showSearch && (
            <div className="filter-search">
              <Search size={13} className="absolute left-[8px] top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
          {filtered.map(opt => (
            <div
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`filter-option ${activeValue === opt.value ? 'active' : ''}`}
            >
              <span
                className="filter-option-dot"
                style={opt.dot && activeValue !== opt.value ? { background: opt.dot } : undefined}
              />
              <span className="filter-option-label">{opt.label}</span>
              <span className="filter-option-count">{opt.count}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default function TaskListPage() {
  const navigate = useNavigate()
  const hasOperation = useAuthStore((s) => s.hasOperation)
  const user = useAuthStore((s) => s.user)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const [activeTab, setActiveTab] = useState<'all' | 'overdue' | 'todo' | 'done'>('all')
  const [filterContract, setFilterContract] = useState('all')
  const [filterPriority, setFilterPriority] = useState<ExecutionPriority | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<ExecutionTaskStatus | 'all'>('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [quickFilters, setQuickFilters] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [tasks, setTasks] = useState<ExecutionTask[]>([])
  const [total, setTotal] = useState(0)
  const [dataReady, setDataReady] = useState(false)
  const [migrating, setMigrating] = useState(false)

  const loadTasks = useCallback(async () => {
    try {
      const params: Record<string, string> = {
        page: String(currentPage),
        pageSize: String(pageSize),
        sortCol: sortField,
        sortDir: sortDir,
      }
      // Map tab to status filter
      if (activeTab === 'overdue') params.status = 'overdue'
      else if (activeTab === 'todo') params.status = 'pending,progress'
      else if (activeTab === 'done') params.status = 'done'
      // Sidebar filters (override tab if set)
      if (filterPriority !== 'all') params.priority = filterPriority
      if (filterStatus !== 'all') params.status = filterStatus
      if (filterAssignee !== 'all') params.assignee = filterAssignee
      if (filterContract !== 'all') params.contractNumber = filterContract
      if (searchText.trim()) params.search = searchText.trim()
      // Quick filters
      if (quickFilters.has('high')) params.priority = 'high'
      if (quickFilters.has('mine')) params.assignee = user?.displayName || ''

      const res = await api.executionTasks.list(params)
      setTasks(res.data)
      setTotal(res.total)
      setDataReady(true)
    } catch (err) {
      console.error('Failed to load execution tasks:', err)
      setDataReady(true)
    }
  }, [currentPage, pageSize, sortField, sortDir, activeTab, filterPriority, filterStatus, filterAssignee, filterContract, searchText, quickFilters, user])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const handleSort = useCallback((field: string) => {
    setSortField(prevField => {
      if (prevField === field) {
        setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
        return prevField
      } else {
        setSortDir('asc')
        return field
      }
    })
    setCurrentPage(1)
  }, [])

  const toggleQuickFilter = useCallback((key: string) => {
    setQuickFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setCurrentPage(1)
  }, [])

  const canView = hasOperation('view_todos')

  // Quick filters apply as additional API params (handled in loadTasks via quickFilters)
  // No client-side filtering — all sorting/filtering is server-side

  const subNavItems = useMemo(() =>
    subNavKeys.map(key => ({
      key,
      label: subNavLabels[key],
      count: key === 'all' ? total
        : key === 'overdue' ? tasks.filter(t => t.status === 'overdue').length
        : key === 'todo' ? tasks.filter(t => t.status === 'pending' || t.status === 'progress').length
        : tasks.filter(t => t.status === 'done').length,
    })),
  [tasks, total])

  const contracts = useMemo(() => {
    const map = new Map<string, number>()
    tasks.forEach(t => { if (t.contract_number) map.set(t.contract_number, (map.get(t.contract_number) || 0) + 1) })
    return Array.from(map.entries()).map(([value, count]) => ({ value, label: value, count }))
  }, [tasks])

  const assignees = useMemo(() => {
    const map = new Map<string, number>()
    tasks.forEach(t => { if (t.assignee) map.set(t.assignee, (map.get(t.assignee) || 0) + 1) })
    return Array.from(map.entries()).map(([value, count]) => ({ value, label: value, count }))
  }, [tasks])

  const stats = useMemo(() => ({
    all: total,
    progress: tasks.filter(t => t.status === 'progress').length,
    overdue: tasks.filter(t => t.status === 'overdue').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    done: tasks.filter(t => t.status === 'done').length,
  }), [tasks, total])

  const handleMarkComplete = (task: { id: string; title: string }) => {
    if (!sendMessage) return
    sendMessage(`请使用 mark_task_complete 工具验证执行任务 ${task.id}（${task.title}）是否真正完成，验证后发送飞书通知`)
  }

  const handleMigrate = async () => {
    setMigrating(true)
    try {
      await api.executionTasks.migrate()
      await loadTasks()
    } catch (err) {
      console.error('Migrate failed:', err)
    } finally {
      setMigrating(false)
    }
  }

  const quickFilterChips = [
    { key: 'high', label: '高优先级' },
    { key: 'mine', label: '我的任务' },
  ]

  const statCards = [
    { key: 'all', label: '全部任务', value: stats.all, color: 'var(--color-fg)', sub: `涉及 ${contracts.length} 份合同 · ${assignees.length} 位负责人` },
    { key: 'progress', label: '进行中', value: stats.progress, color: 'var(--color-accent)', sub: `占比 ${stats.all > 0 ? ((stats.progress / stats.all) * 100).toFixed(1) : '0'}%` },
    { key: 'overdue', label: '逾期未处理', value: stats.overdue, color: 'var(--color-danger)', sub: '需立即处理' },
    { key: 'pending', label: '待开始', value: stats.pending, color: 'var(--color-muted)', sub: `占比 ${stats.all > 0 ? ((stats.pending / stats.all) * 100).toFixed(1) : '0'}%` },
    { key: 'done', label: '已完成', value: stats.done, color: 'var(--color-success)', sub: `占比 ${stats.all > 0 ? ((stats.done / stats.all) * 100).toFixed(1) : '0'}%` },
  ]

  const exportCSV = () => {
    const header = '任务编号,关联合同,任务说明,步骤数,优先级,负责人,截止日期,状态'
    const rows = tasks.map(t => `${t.id},${t.contract_number},"${t.title} ${t.description}",${t.stepCount || 1},${t.priorityLabel},${t.assignee},${t.due_date},${t.statusLabel}`)
    const csv = '﻿' + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '执行任务列表.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns: Column<ExecutionTask>[] = [
    {
      key: 'id',
      title: '任务编号',
      width: 150,
      sortable: true,
      render: (_, task) => (
        <button
          onClick={() => navigate(`/task/${task.id}`)}
          className="td-id"
        >
          {task.id}
        </button>
      ),
    },
    {
      key: 'contract_number',
      title: '关联合同',
      width: 130,
      render: (v) => v || '—',
    },
    {
      key: 'title',
      title: '任务说明',
      render: (v, task) => (
        <div>
          <div className="td-title">{v}</div>
          <div className="td-title-desc">{task.description}</div>
        </div>
      ),
    },
    {
      key: 'stepCount',
      title: '步骤数',
      width: 70,
      align: 'center',
      render: (v) => <span className="font-mono text-xs">{v || 1}</span>,
    },
    {
      key: 'priority',
      title: '优先级',
      width: 80,
      sortable: true,
      render: (_, task) => (
        <span className="priority-badge">
          <span className={`priority-dot ${priorityDotClass(task.priority)}`} />
          {task.priorityLabel}
        </span>
      ),
    },
    {
      key: 'assignee',
      title: '负责人',
      width: 100,
      render: (v) => (
        <div className="td-assignee">
          <div className="assignee-avatar">{(v as string).charAt(0)}</div>
          {v}
        </div>
      ),
    },
    {
      key: 'due_date',
      title: '截止日期',
      width: 110,
      sortable: true,
      render: (v, task) => <span className={task.status === 'overdue' ? 'text-danger' : ''}>{v || '—'}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 80,
      render: (_, task) => (
        <span className={`badge-pill ${statusBadgeClass(task.status)}`}>
          {task.statusLabel}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 150,
      render: (_, task) => (
        <div className="td-actions">
          <button
            onClick={() => navigate(`/task/${task.id}`)}
            className="td-id"
            style={{ fontSize: '12px' }}
          >
            处理
          </button>
          {task.status !== 'done' && (
            <>
              <span style={{ color: 'var(--color-border)', margin: '0 6px' }}>|</span>
              <button
                className="td-contract"
                style={{ fontSize: '12px', color: 'var(--color-success)' }}
                onClick={() => handleMarkComplete(task)}
              >
                标记完成
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  const handleTabChange = (key: string) => {
    setActiveTab(key as 'all' | 'overdue' | 'todo' | 'done')
    setFilterContract('all')
    setCurrentPage(1)
  }

  if (!canView) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <SubNav items={subNavItems} activeKey={activeTab} onChange={handleTabChange} />
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-muted)]">
          无权限访问 — 需要 view_todos 操作权限
        </div>
      </div>
    )
  }

  if (!dataReady) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <SubNav items={subNavItems} activeKey={activeTab} onChange={handleTabChange} />
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-muted)]">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SubNav
        items={subNavItems}
        activeKey={activeTab}
        onChange={handleTabChange}
      />

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[240px] bg-surface border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <FilterGroup
              title="关联合同"
              options={[{ value: 'all', label: '全部合同', count: total }, ...contracts]}
              activeValue={filterContract}
              onChange={v => { setFilterContract(v); setCurrentPage(1) }}
              showSearch
              searchPlaceholder="搜索合同编号..."
            />
            <FilterGroup
              title="优先级"
              options={[{ value: 'all', label: '全部优先级', count: total }, ...priorityOptions.map(o => ({ ...o, count: tasks.filter(t => t.priority === o.value).length }))]}
              activeValue={filterPriority}
              onChange={v => { setFilterPriority(v as ExecutionPriority | 'all'); setCurrentPage(1) }}
            />
            <FilterGroup
              title="任务状态"
              options={[{ value: 'all', label: '全部状态', count: total }, ...statusOptions.map(o => ({ ...o, count: tasks.filter(t => t.status === o.value).length }))]}
              activeValue={filterStatus}
              onChange={v => { setFilterStatus(v as ExecutionTaskStatus | 'all'); setCurrentPage(1) }}
            />
            <FilterGroup
              title="负责人"
              options={[{ value: 'all', label: '全部人员', count: total }, ...assignees]}
              activeValue={filterAssignee}
              onChange={v => { setFilterAssignee(v); setCurrentPage(1) }}
              showSearch
              searchPlaceholder="搜索负责人..."
            />
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden bg-bg">
          <div className="content-toolbar">
            <div className="content-toolbar-left">
              <div className="search-box">
                <span className="search-box-icon">
                  <Search size={14} />
                </span>
                <input
                  type="text"
                  value={searchText}
                  onChange={e => { setSearchText(e.target.value); setCurrentPage(1) }}
                  placeholder="搜索任务编号、合同、说明..."
                  className="search-box-input"
                />
              </div>
              <div className="filter-chips">
                {quickFilterChips.map(chip => (
                  <button
                    key={chip.key}
                    onClick={() => toggleQuickFilter(chip.key)}
                    className={`filter-chip ${quickFilters.has(chip.key) ? 'active' : ''}`}
                  >
                    {chip.label}
                    {quickFilters.has(chip.key) && (
                      <X size={12} className="filter-chip-close" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="content-toolbar-right">
              <button
                className="btn btn-outline btn-sm inline-flex items-center gap-1"
                onClick={handleMigrate}
                disabled={migrating}
              >
                <RefreshCw size={12} className={migrating ? 'animate-spin' : ''} />
                {migrating ? '迁移中' : '迁移旧任务'}
              </button>
              <span className="page-btn" style={{ border: 'none', color: 'var(--color-muted)', fontSize: '11px', width: 'auto', cursor: 'default' }}>
                共 <strong style={{ color: 'var(--color-fg)' }}>{total}</strong> 条
              </span>
              {hasOperation('update_todos') && <button className="btn btn-outline btn-sm">批量标记完成</button>}
              {hasOperation('export_orders') && <button className="btn btn-outline btn-sm" onClick={exportCSV}>导出</button>}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectMode(!selectMode)}
              >
                {selectMode ? '取消批量' : '批量操作'}
              </button>
            </div>
          </div>

          <div className="stat-strip">
            {statCards.map(card => (
              <button
                key={card.key}
                onClick={() => {
                  if (card.key === 'all') setFilterStatus('all')
                  else setFilterStatus(card.key as ExecutionTaskStatus)
                  setCurrentPage(1)
                }}
                className="stat-card"
              >
                <span className="stat-card-label">{card.label}</span>
                <span className="stat-card-value" style={{ color: card.color }}>{card.value}</span>
                <span className="stat-card-sub">{card.sub}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            <DataTable<ExecutionTask>
              columns={columns}
              data={tasks}
              rowKey="id"
              selectable={selectMode}
              selectedRowKeys={Array.from(selectedTasks)}
              onSelectChange={(keys) => setSelectedTasks(new Set(keys))}
              sort={{
                field: sortField,
                direction: sortDir,
                onChange: handleSort,
              }}
              pagination={{
                current: currentPage,
                pageSize,
                total,
                onChange: (page, size) => {
                  setCurrentPage(page)
                  setPageSize(size)
                },
              }}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
