import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Column } from './DataTable'

interface MasterDetailTableProps<M, D> {
  masterColumns: Column<M>[]
  detailColumns: Column<D>[]
  masterData: M[]
  loadDetailData: (masterRecord: M) => Promise<D[]> | D[]
  masterKey: keyof M
  detailKey: keyof D
  masterWidth?: string
  onMasterSelect?: (record: M) => void
  loading?: boolean
}

export default function MasterDetailTable<M extends Record<string, any>, D extends Record<string, any>>({
  masterColumns,
  detailColumns,
  masterData,
  loadDetailData,
  masterKey,
  detailKey,
  masterWidth = '40%',
  onMasterSelect,
  loading,
}: MasterDetailTableProps<M, D>) {
  const [selectedMaster, setSelectedMaster] = useState<M | null>(null)
  const [detailData, setDetailData] = useState<D[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailPage, setDetailPage] = useState(1)
  const [detailPageSize, setDetailPageSize] = useState(10)

  const loadDetail = useCallback(async (record: M) => {
    setDetailLoading(true)
    try {
      const data = await loadDetailData(record)
      setDetailData(Array.isArray(data) ? data : [])
      setDetailPage(1)
    } catch (err) {
      console.error('Load detail error:', err)
      setDetailData([])
    } finally {
      setDetailLoading(false)
    }
  }, [loadDetailData])

  useEffect(() => {
    if (masterData.length > 0 && !selectedMaster) {
      const first = masterData[0]
      setSelectedMaster(first)
      loadDetail(first)
      onMasterSelect?.(first)
    }
  }, [masterData, selectedMaster, loadDetail, onMasterSelect])

  const handleSelectMaster = (record: M) => {
    setSelectedMaster(record)
    loadDetail(record)
    onMasterSelect?.(record)
  }

  const totalDetailPages = Math.max(1, Math.ceil(detailData.length / detailPageSize))
  const safeDetailPage = Math.min(detailPage, totalDetailPages)
  const detailStart = (safeDetailPage - 1) * detailPageSize
  const pageDetailData = detailData.slice(detailStart, detailStart + detailPageSize)

  return (
    <div className="master-detail-container flex h-full overflow-hidden border border-border rounded-lg bg-surface shadow-sm">
      {/* Master */}
      <div className="master-detail-master border-r border-border overflow-auto" style={{ width: masterWidth }}>
        <table className="master-detail-table">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border">
            <tr>
              {masterColumns.map((col) => (
                <th
                  key={String(col.key)}
                  style={{ width: col.width, textAlign: col.align }}
                  className="master-detail-th"
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={masterColumns.length} className="text-center text-muted py-8">加载中...</td></tr>
            ) : masterData.length === 0 ? (
              <tr><td colSpan={masterColumns.length} className="text-center text-muted py-8">暂无数据</td></tr>
            ) : (
              masterData.map((record) => {
                const key = String(record[masterKey])
                const isSelected = selectedMaster && String(selectedMaster[masterKey]) === key
                return (
                  <tr
                    key={key}
                    className={cn(
                      'cursor-pointer hover:bg-bg',
                      isSelected && 'master-detail-selected'
                    )}
                    onClick={() => handleSelectMaster(record)}
                  >
                    {masterColumns.map((col) => {
                      const value = record[col.key as keyof M]
                      return (
                        <td
                          key={String(col.key)}
                          style={{ textAlign: col.align }}
                          className="master-detail-td"
                        >
                          {col.render ? col.render(value, record as any, 0) : value}
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

      {/* Detail */}
      <div className="master-detail-detail flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="master-detail-table">
            <thead className="sticky top-0 z-10 bg-surface border-b border-border">
              <tr>
                {detailColumns.map((col) => (
                  <th
                    key={String(col.key)}
                    style={{ width: col.width, textAlign: col.align }}
                    className="master-detail-th"
                  >
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detailLoading ? (
                <tr><td colSpan={detailColumns.length} className="text-center text-muted py-8">加载中...</td></tr>
              ) : pageDetailData.length === 0 ? (
                <tr><td colSpan={detailColumns.length} className="text-center text-muted py-8">暂无明细数据</td></tr>
              ) : (
                pageDetailData.map((record) => (
                  <tr key={String(record[detailKey])} className="hover:bg-bg">
                    {detailColumns.map((col) => {
                      const value = record[col.key as keyof D]
                      return (
                        <td
                          key={String(col.key)}
                          style={{ textAlign: col.align }}
                          className="master-detail-td"
                        >
                          {col.render ? col.render(value, record as any, 0) : value}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {detailData.length > 0 && (
          <div className="pagination shrink-0 border-t border-border">
            <div className="pagination-info">
              明细 {detailData.length} 条
            </div>
            <div className="pagination-controls">
              <button
                className="page-btn"
                disabled={safeDetailPage <= 1}
                onClick={() => setDetailPage(safeDetailPage - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: totalDetailPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className={cn('page-btn', p === safeDetailPage && 'active')}
                  onClick={() => setDetailPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                className="page-btn"
                disabled={safeDetailPage >= totalDetailPages}
                onClick={() => setDetailPage(safeDetailPage + 1)}
              >
                <ChevronRight size={14} />
              </button>
              <select
                className="page-size-select"
                value={detailPageSize}
                onChange={(e) => { setDetailPageSize(Number(e.target.value)); setDetailPage(1) }}
              >
                <option value={10}>10/页</option>
                <option value={20}>20/页</option>
                <option value={50}>50/页</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
