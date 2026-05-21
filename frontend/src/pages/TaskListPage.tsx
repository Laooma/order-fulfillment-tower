import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, X } from 'lucide-react'
import SubNav from '../components/SubNav'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import type { TaskType, TaskStatus, BusinessType, Priority } from '../types'

let allMockTasks: any[] = []

const subNavKeys = ['all', 'ship', 'inbound', 'contract', 'exception'] as const
const subNavLabels: Record<string, string> = {
  all: '全部任务', ship: '发货任务', inbound: '入库任务', contract: '合同确认', exception: '异常处理',
}


const typeOptions = [
  { value: 'agent', label: 'Agent任务', dot: 'var(--color-accent)' },
  { value: 'decision', label: '决策任务', dot: 'var(--color-warning)' },
  { value: 'manual', label: '手工任务', dot: 'var(--color-muted)' },
]

const priorityOptions = [
  { value: 'high', label: '高优先级', dot: 'var(--color-danger)' },
  { value: 'mid', label: '中优先级', dot: 'var(--color-warning)' },
  { value: 'low', label: '低优先级', dot: 'var(--color-muted)' },
]

const statusOptions = [
  { value: 'pending', label: '待开始', dot: 'var(--color-muted)' },
  { value: 'progress', label: '进行中', dot: 'var(--color-accent)' },
  { value: 'overdue', label: '已逾期', dot: 'var(--color-danger)' },
  { value: 'done', label: '已完成', dot: 'var(--color-success)' },
]

function priorityOrder(p: Priority) {
  const order: Record<string, number> = { high: 0, mid: 1, low: 2 }
  return order[p] ?? 99
}

function getDetailPath(type: TaskType, id: string) {
  return `/task/${type}/${id}`
}

function statusBadgeClass(s: TaskStatus) {
  switch (s) {
    case 'progress': return 'progress'
    case 'overdue': return 'danger'
    case 'done': return 'success'
    default: return 'default'
  }
}

function priorityDotClass(p: Priority) {
  switch (p) {
    case 'high': return 'high'
    case 'mid': return 'mid'
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
  const [activeCategory, setActiveCategory] = useState<BusinessType | 'all'>('all')
  const [filterContract, setFilterContract] = useState('all')
  const [filterType, setFilterType] = useState<TaskType | 'all'>('all')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [quickFilters, setQuickFilters] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<string>('id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [dataReady, setDataReady] = useState(false)

  useEffect(() => {
    api.tasks.list({ pageSize: '100' })
      .then((res) => {
        allMockTasks = res.data
        setDataReady(true)
      })
      .catch((err) => {
        console.error('Failed to load tasks:', err)
        setDataReady(true)
      })
  }, [])

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setCurrentPage(1)
  }, [sortField])

  const toggleQuickFilter = useCallback((key: string) => {
    setQuickFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setCurrentPage(1)
  }, [])

  const filteredTasks = useMemo(() => {
    let tasks = [...allMockTasks]

    if (activeCategory !== 'all') tasks = tasks.filter(t => t.category === activeCategory)
    if (filterContract !== 'all') tasks = tasks.filter(t => t.contractId === filterContract)
    if (filterType !== 'all') tasks = tasks.filter(t => t.type === filterType)
    if (filterPriority !== 'all') tasks = tasks.filter(t => t.priority === filterPriority)
    if (filterStatus !== 'all') tasks = tasks.filter(t => t.status === filterStatus)
    if (filterAssignee !== 'all') tasks = tasks.filter(t => t.assignee === filterAssignee)

    if (quickFilters.has('overdue')) tasks = tasks.filter(t => t.status === 'overdue')
    if (quickFilters.has('high')) tasks = tasks.filter(t => t.priority === 'high')
    if (quickFilters.has('mine')) tasks = tasks.filter(t => t.assignee === '张伟')
    if (quickFilters.has('today')) tasks = tasks.filter(t => t.dueDate === '2024/11/14')

    if (searchText.trim()) {
      const s = searchText.toLowerCase()
      tasks = tasks.filter(t =>
        t.id.toLowerCase().includes(s) ||
        t.contractId.toLowerCase().includes(s) ||
        t.title.includes(s) ||
        t.description.includes(s) ||
        t.assignee.includes(s)
      )
    }

    tasks.sort((a, b) => {
      let cmp = 0
      if (sortField === 'id') cmp = a.id.localeCompare(b.id)
      else if (sortField === 'priority') cmp = priorityOrder(a.priority) - priorityOrder(b.priority)
      else if (sortField === 'dueDate') cmp = a.dueDate.localeCompare(b.dueDate)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return tasks
  }, [activeCategory, filterContract, filterType, filterPriority, filterStatus, filterAssignee, quickFilters, searchText, sortField, sortDir, dataReady])

  const totalCount = filteredTasks.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIdx = (safePage - 1) * pageSize
  const pageTasks = filteredTasks.slice(startIdx, startIdx + pageSize)

  const subNavItems = useMemo(() =>
    subNavKeys.map(key => ({
      key,
      label: subNavLabels[key],
      count: key === 'all' ? allMockTasks.length : allMockTasks.filter(t => t.category === key).length,
    })),
  [dataReady])

  const contracts = useMemo(() => {
    const map = new Map<string, number>()
    allMockTasks.forEach(t => { if (t.contractId) map.set(t.contractId, (map.get(t.contractId) || 0) + 1) })
    return Array.from(map.entries()).map(([value, count]) => ({ value, label: value, count }))
  }, [dataReady])

  const assignees = useMemo(() => {
    const map = new Map<string, number>()
    allMockTasks.forEach(t => { if (t.assignee) map.set(t.assignee, (map.get(t.assignee) || 0) + 1) })
    return Array.from(map.entries()).map(([value, count]) => ({ value, label: value, count }))
  }, [dataReady])

  const stats = useMemo(() => ({
    all: allMockTasks.length,
    progress: allMockTasks.filter(t => t.status === 'progress').length,
    overdue: allMockTasks.filter(t => t.status === 'overdue').length,
    pending: allMockTasks.filter(t => t.status === 'pending').length,
    done: allMockTasks.filter(t => t.status === 'done').length,
  }), [dataReady])

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTasks(new Set(pageTasks.map(t => t.id)))
    } else {
      setSelectedTasks(new Set())
    }
  }

  const handleSelectTask = (id: string, checked: boolean) => {
    setSelectedTasks(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleCategoryChange = (key: string) => {
    setActiveCategory(key as BusinessType | 'all')
    setFilterContract('all')
    setCurrentPage(1)
  }

  const quickFilterChips = [
    { key: 'overdue', label: '逾期任务' },
    { key: 'today', label: '今日到期' },
    { key: 'mine', label: '我的任务' },
    { key: 'high', label: '高优先级' },
  ]

  const statCards = [
    { key: 'all', label: '全部任务', value: stats.all, color: 'var(--color-fg)', sub: `涉及 ${contracts.length} 份合同 · ${assignees.length} 位负责人` },
    { key: 'progress', label: '进行中', value: stats.progress, color: 'var(--color-accent)', sub: `占比 ${stats.all > 0 ? ((stats.progress / stats.all) * 100).toFixed(1) : '0'}%` },
    { key: 'overdue', label: '逾期未处理', value: stats.overdue, color: 'var(--color-danger)', sub: '需立即处理' },
    { key: 'pending', label: '待开始', value: stats.pending, color: 'var(--color-muted)', sub: `占比 ${stats.all > 0 ? ((stats.pending / stats.all) * 100).toFixed(1) : '0'}%` },
    { key: 'done', label: '已完成', value: stats.done, color: 'var(--color-success)', sub: `占比 ${stats.all > 0 ? ((stats.done / stats.all) * 100).toFixed(1) : '0'}%` },
  ]

  const exportCSV = () => {
    const header = '任务编号,关联合同,任务类型,任务说明,优先级,负责人,截止日期,状态'
    const rows = filteredTasks.map(t => `${t.id},${t.contractId},${t.typeLabel},"${t.title} ${t.description}",${t.priorityLabel},${t.assignee},${t.dueDate},${t.statusLabel}`)
    const csv = '﻿' + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '任务列表.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const sortArrow = (field: string) => {
    if (sortField !== field) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  if (!dataReady) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <SubNav items={subNavItems} activeKey={activeCategory} onChange={handleCategoryChange} />
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-muted)]">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SubNav
        items={subNavItems}
        activeKey={activeCategory}
        onChange={handleCategoryChange}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-[240px] bg-surface border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <FilterGroup
              title="关联合同"
              options={[{ value: 'all', label: '全部合同', count: 42 }, ...contracts]}
              activeValue={filterContract}
              onChange={v => { setFilterContract(v); setCurrentPage(1) }}
              showSearch
              searchPlaceholder="搜索合同编号..."
            />
            <FilterGroup
              title="任务类型"
              options={[{ value: 'all', label: '全部类型', count: 42 }, ...typeOptions.map(o => ({ ...o, count: allMockTasks.filter(t => t.type === o.value).length }))]}
              activeValue={filterType}
              onChange={v => { setFilterType(v as TaskType | 'all'); setCurrentPage(1) }}
            />
            <FilterGroup
              title="优先级"
              options={[{ value: 'all', label: '全部优先级', count: 42 }, ...priorityOptions.map(o => ({ ...o, count: allMockTasks.filter(t => t.priority === o.value).length }))]}
              activeValue={filterPriority}
              onChange={v => { setFilterPriority(v as Priority | 'all'); setCurrentPage(1) }}
            />
            <FilterGroup
              title="任务状态"
              options={[{ value: 'all', label: '全部状态', count: 42 }, ...statusOptions.map(o => ({ ...o, count: allMockTasks.filter(t => t.status === o.value).length }))]}
              activeValue={filterStatus}
              onChange={v => { setFilterStatus(v as TaskStatus | 'all'); setCurrentPage(1) }}
            />
            <FilterGroup
              title="负责人"
              options={[{ value: 'all', label: '全部人员', count: 42 }, ...assignees]}
              activeValue={filterAssignee}
              onChange={v => { setFilterAssignee(v); setCurrentPage(1) }}
              showSearch
              searchPlaceholder="搜索负责人..."
            />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden bg-bg">
          {/* Toolbar */}
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
              <span className="page-btn" style={{ border: 'none', color: 'var(--color-muted)', fontSize: '11px', width: 'auto', cursor: 'default' }}>
                共 <strong style={{ color: 'var(--color-fg)' }}>{totalCount}</strong> 条
              </span>
              {hasOperation('update_todos') && <button className="btn btn-outline btn-sm">批量标记完成</button>}
              {hasOperation('assign_todos') && <button className="btn btn-accent btn-sm">分配任务</button>}
              {hasOperation('export_orders') && <button className="btn btn-outline btn-sm" onClick={exportCSV}>导出</button>}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectMode(!selectMode)}
              >
                {selectMode ? '取消批量' : '批量操作'}
              </button>
            </div>
          </div>

          {/* Stat Strip */}
          <div className="stat-strip">
            {statCards.map(card => (
              <button
                key={card.key}
                onClick={() => {
                  if (card.key === 'all') setFilterStatus('all')
                  else setFilterStatus(card.key as TaskStatus)
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

          {/* Data Table */}
          <div className="flex-1 overflow-auto">
            <table className="task-table">
              <thead>
                <tr>
                  <th style={{ width: '36px', display: selectMode ? '' : 'none' }}>
                    <input
                      type="checkbox"
                      checked={pageTasks.length > 0 && pageTasks.every(t => selectedTasks.has(t.id))}
                      onChange={e => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th style={{ width: '24px' }}>#</th>
                  <th
                    onClick={() => handleSort('id')}
                    className={`sortable ${sortField === 'id' ? sortDir : ''}`}
                    style={{ width: '140px', minWidth: '130px' }}
                  >
                    任务编号 <span className="sort-arrow">{sortArrow('id')}</span>
                  </th>
                  <th style={{ width: '130px', minWidth: '120px' }}>关联合同</th>
                  <th style={{ width: '90px' }}>任务类型</th>
                  <th style={{ minWidth: '200px' }}>任务说明</th>
                  <th
                    onClick={() => handleSort('priority')}
                    className={`sortable ${sortField === 'priority' ? sortDir : ''}`}
                    style={{ width: '70px' }}
                  >
                    优先级 <span className="sort-arrow">{sortArrow('priority')}</span>
                  </th>
                  <th style={{ width: '100px' }}>负责人</th>
                  <th
                    onClick={() => handleSort('dueDate')}
                    className={`sortable ${sortField === 'dueDate' ? sortDir : ''}`}
                    style={{ width: '100px' }}
                  >
                    截止日期 <span className="sort-arrow">{sortArrow('dueDate')}</span>
                  </th>
                  <th style={{ width: '80px' }}>状态</th>
                  <th style={{ width: '130px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageTasks.map((task, idx) => (
                  <tr
                    key={task.id}
                    className={`${task.status === 'overdue' ? 'row-overdue' : ''} ${selectedTasks.has(task.id) ? 'selected' : ''}`}
                  >
                    <td style={{ display: selectMode ? '' : 'none' }}>
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={e => handleSelectTask(task.id, e.target.checked)}
                      />
                    </td>
                    <td style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                      {String(startIdx + idx + 1).padStart(2, '0')}
                    </td>
                    <td>
                      <button
                        onClick={() => navigate(getDetailPath(task.type, task.id))}
                        className="td-id"
                      >
                        {task.id}
                      </button>
                    </td>
                    <td>
                      <button
                        onClick={() => { setFilterContract(task.contractId); setCurrentPage(1) }}
                        className="td-contract"
                      >
                        {task.contractId}
                      </button>
                    </td>
                    <td>
                      <span className={`task-type-badge ${task.type}`}>
                        {task.typeLabel}
                      </span>
                    </td>
                    <td>
                      <div className="td-title">{task.title}</div>
                      <div className="td-title-desc">{task.description}</div>
                    </td>
                    <td>
                      <span className="priority-badge">
                        <span className={`priority-dot ${priorityDotClass(task.priority)}`} />
                        {task.priorityLabel}
                      </span>
                    </td>
                    <td>
                      <div className="td-assignee">
                        <div className="assignee-avatar">{task.assignee.charAt(0)}</div>
                        {task.assignee}
                      </div>
                    </td>
                    <td className={`td-date ${task.status === 'overdue' ? 'overdue' : ''}`}>
                      {task.dueDate}
                    </td>
                    <td>
                      <span className={`badge-pill ${statusBadgeClass(task.status)}`}>
                        {task.statusLabel}
                      </span>
                    </td>
                    <td>
                      <div className="td-actions">
                        <button
                          onClick={() => navigate(getDetailPath(task.type, task.id))}
                          className="td-id"
                          style={{ fontSize: '12px' }}
                        >
                          处理
                        </button>
                        {hasOperation('update_todos') && (
                          <>
                            <span style={{ color: 'var(--color-border)', margin: '0 6px' }}>|</span>
                            <button
                              className="td-contract"
                              style={{ fontSize: '12px', ...(task.status === 'overdue' ? { color: 'var(--color-danger)' } : {}) }}
                            >
                              {task.status === 'overdue' ? '催办' : '转交'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {pageTasks.length === 0 && (
                  <tr>
                    <td colSpan={selectMode ? 12 : 11} className="text-center text-muted text-sm" style={{ padding: '48px' }}>
                      暂无符合条件的任务
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination">
            <div className="pagination-info">
              显示 <span style={{ fontFamily: 'var(--font-mono)' }}>{totalCount > 0 ? startIdx + 1 : 0}</span>–<span style={{ fontFamily: 'var(--font-mono)' }}>{Math.min(startIdx + pageSize, totalCount)}</span> 条，共 <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{totalCount}</span> 条
            </div>
            <div className="pagination-controls">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="page-btn"
                style={safePage <= 1 ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  className={`page-btn ${p === safePage ? 'active' : ''}`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="page-btn"
                style={safePage >= totalPages ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              >
                ›
              </button>
              <div style={{ width: '8px' }} />
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
                className="page-size-select"
              >
                <option value={20}>20/页</option>
                <option value={50}>50/页</option>
                <option value={100}>100/页</option>
              </select>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
