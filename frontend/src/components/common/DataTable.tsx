import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface Column<T> {
  key: keyof T | string
  title: string
  width?: string | number
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  render?: (value: any, record: T, index: number) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: keyof T | ((record: T) => string)
  loading?: boolean
  pagination?: {
    current: number
    pageSize: number
    total: number
    onChange: (page: number, pageSize: number) => void
  }
  sort?: {
    field: string
    direction: 'asc' | 'desc'
    onChange: (field: string) => void
  }
  onRowClick?: (record: T) => void
  rowClassName?: (record: T) => string
  emptyText?: string
  selectable?: boolean
  selectedRowKeys?: string[]
  onSelectChange?: (keys: string[]) => void
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  rowKey,
  loading,
  pagination,
  sort,
  onRowClick,
  rowClassName,
  emptyText = '暂无数据',
  selectable,
  selectedRowKeys = [],
  onSelectChange,
}: DataTableProps<T>) {
  const getKey = (record: T) => (typeof rowKey === 'function' ? rowKey(record) : String(record[rowKey as keyof T]))

  const allSelected = data.length > 0 && data.every((r) => selectedRowKeys.includes(getKey(r)))
  const someSelected = data.some((r) => selectedRowKeys.includes(getKey(r))) && !allSelected

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectChange) return
    if (checked) {
      onSelectChange(data.map((r) => getKey(r)))
    } else {
      onSelectChange([])
    }
  }

  const handleSelectRow = (record: T, checked: boolean) => {
    if (!onSelectChange) return
    const key = getKey(record)
    if (checked) {
      onSelectChange([...selectedRowKeys, key])
    } else {
      onSelectChange(selectedRowKeys.filter((k) => k !== key))
    }
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1
  const current = pagination ? Math.min(pagination.current, totalPages) : 1

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="task-table w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              {selectable && (
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  style={{ width: col.width, textAlign: col.align }}
                  className={cn(col.sortable && 'sortable cursor-pointer', sort?.field === col.key && sort?.direction)}
                  onClick={() => col.sortable && sort?.onChange(String(col.key))}
                >
                  {col.title}
                  {col.sortable && (
                    <span className="sort-arrow ml-1">
                      {sort?.field !== col.key ? '↕' : sort.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center text-muted py-12">
                  加载中...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center text-muted py-12">
                  {emptyText}
                </td>
              </tr>
            ) : (
              data.map((record, idx) => {
                const key = getKey(record)
                return (
                  <tr
                    key={key}
                    className={cn(
                      onRowClick && 'cursor-pointer hover:bg-surface/60',
                      rowClassName?.(record),
                      selectedRowKeys.includes(key) && 'selected'
                    )}
                    onClick={() => onRowClick?.(record)}
                  >
                    {selectable && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedRowKeys.includes(key)}
                          onChange={(e) => handleSelectRow(record, e.target.checked)}
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const value = (record as any)[col.key]
                      return (
                        <td
                          key={String(col.key)}
                          style={{ textAlign: col.align }}
                          onClick={(e) => {
                            if (selectable) e.stopPropagation()
                          }}
                        >
                          {col.render ? col.render(value, record, idx) : value}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="pagination shrink-0">
          <div className="pagination-info">
            显示 <span style={{ fontFamily: 'var(--font-mono)' }}>{pagination.total > 0 ? (current - 1) * pagination.pageSize + 1 : 0}</span>
            –
            <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.min(current * pagination.pageSize, pagination.total)}</span>
            {' '}条，共 <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{pagination.total}</span> 条
          </div>
          <div className="pagination-controls">
            <button
              className="page-btn"
              disabled={current <= 1}
              onClick={() => pagination.onChange(current - 1, pagination.pageSize)}
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                className={cn('page-btn', p === current && 'active')}
                onClick={() => pagination.onChange(p, pagination.pageSize)}
              >
                {p}
              </button>
            ))}
            <button
              className="page-btn"
              disabled={current >= totalPages}
              onClick={() => pagination.onChange(current + 1, pagination.pageSize)}

            >
              <ChevronRight size={14} />
            </button>
            <select
              className="page-size-select"
              value={pagination.pageSize}
              onChange={(e) => pagination.onChange(1, Number(e.target.value))}
            >
              <option value={10}>10/页</option>
              <option value={20}>20/页</option>
              <option value={50}>50/页</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
