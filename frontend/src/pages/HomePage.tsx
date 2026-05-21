import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../lib/utils'
import { useChatStore } from '../stores/chatStore'
import { api } from '../lib/api'
import { useA2uiStore } from '../stores/a2uiStore'

function recvClass(v: number) {
  return v >= 80 ? 'badge-success' : v >= 50 ? 'badge-warning' : 'badge-danger'
}
function progClass(v: number) {
  return v >= 80 ? 'full' : v >= 50 ? 'warn' : 'over'
}

export default function HomePage() {
  const navigate = useNavigate()
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [showFilterModal, setShowFilterModal] = useState(false)

  // ── Filter State ──
  // A2UI analysis result surface
  const a2uiStore = useA2uiStore()

  const emptyFilters = { salesperson: '', brand: '', receiptStatus: '', deliveryStatus: '', isException: '', customer: '', buyer: '', supplier: '', shipPlan: '', shipStatus: '' }
  const [filters, setFilters] = useState<Record<string, string>>(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>(emptyFilters)
  const updateFilter = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  // ── API Data ──
  const [orders, setOrders] = useState<any[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersTotal, setOrdersTotal] = useState(0)
  const [orderPage, setOrderPage] = useState(1)
  const [orderPageSize, setOrderPageSize] = useState(20)

  // Load orders from API
  useEffect(() => {
    setOrdersLoading(true)
    const params: Record<string, string> = { page: String(orderPage), pageSize: String(orderPageSize) }
    if (appliedFilters.salesperson) params.salesperson = appliedFilters.salesperson
    if (appliedFilters.brand) params.brand = appliedFilters.brand
    if (appliedFilters.receiptStatus) params.receiptStatus = appliedFilters.receiptStatus
    if (appliedFilters.deliveryStatus) params.deliveryStatus = appliedFilters.deliveryStatus
    if (appliedFilters.isException) params.isException = appliedFilters.isException === '异常' ? 'true' : appliedFilters.isException === '正常' ? 'false' : ''
    if (appliedFilters.customer) params.customer = appliedFilters.customer
    api.orders.list(params)
      .then((res) => {
        setOrders(res.data)
        setOrdersTotal(res.total)
      })
      .catch((err) => console.error('Failed to load orders:', err))
      .finally(() => setOrdersLoading(false))
  }, [orderPage, orderPageSize, appliedFilters])

  const handleSearch = () => {
    setAppliedFilters({ ...filters })
    setOrderPage(1)
  }

  const handleReset = () => {
    setFilters({ ...emptyFilters })
    setAppliedFilters({ ...emptyFilters })
    setOrderPage(1)
  }

  const toggleOrder = useCallback((num: string) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num)
      else next.add(num)
      return next
    })
  }, [])

  const handleClearOrders = useCallback(() => {
    setSelectedOrders(new Set())
  }, [])

  // Set page config for A2UI analysis surface
  const setPageConfig = useChatStore((s) => s.setPageConfig)

  useEffect(() => {
    setPageConfig({
      page: 'home',
      sessionId: 'home',
      orders: Array.from(selectedOrders),
      onClearOrders: handleClearOrders,
      onAnalysisNavigate: (path) => navigate(path),
      onA2uiSurface: (data: { title: string; messages: unknown[] }) => {
        a2uiStore.setSurface(data.title, data.messages as any[])
        navigate('/a2ui')
      },
    })
    return () => {
      setPageConfig(null)
    }
  }, [selectedOrders, handleClearOrders, navigate, setPageConfig])

  return (
    <div className="flex h-full">
      {/* ── Center: Order List ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg" style={{ position: 'relative' }}>
        {/* Filter Panel */}
        <div className="filter-panel">
          <div className="filter-row">
            <div className="filter-group">
              <div className="filter-item">
                <span className="filter-item-label">销售员</span>
                <input className="filter-input" type="text" placeholder="请输入" value={filters.salesperson} onChange={(e) => updateFilter('salesperson', e.target.value)} />
              </div>
              <div className="filter-item">
                <span className="filter-item-label">品牌主体</span>
                <input className="filter-input" type="text" placeholder="请输入" value={filters.brand} onChange={(e) => updateFilter('brand', e.target.value)} />
              </div>
              <div className="filter-item">
                <span className="filter-item-label">签收状态</span>
                <select className="filter-select" value={filters.receiptStatus} onChange={(e) => updateFilter('receiptStatus', e.target.value)}>
                  <option value="">—请选择—</option>
                  <option>未签收</option>
                  <option>部分签收</option>
                  <option>全部签收</option>
                </select>
              </div>
              <div className="filter-item">
                <span className="filter-item-label">出库状态</span>
                <select className="filter-select" value={filters.deliveryStatus} onChange={(e) => updateFilter('deliveryStatus', e.target.value)}>
                  <option value="">—请选择—</option>
                  <option>待出库</option>
                  <option>已出库</option>
                  <option>部分出库</option>
                </select>
              </div>
              <div className="filter-item">
                <span className="filter-item-label">是否异常</span>
                <select className="filter-select" value={filters.isException} onChange={(e) => updateFilter('isException', e.target.value)}>
                  <option value="">—请选择—</option>
                  <option>正常</option>
                  <option>异常</option>
                </select>
              </div>
            </div>
            <div className="filter-actions">
              <button className="btn btn-outline" style={{ height: 28, fontSize: 12 }} onClick={() => setShowFilterModal(true)}>
                配置筛选字段
              </button>
            </div>
          </div>
          <div className="filter-row">
            <div className="filter-group">
              <div className="filter-item">
                <span className="filter-item-label">客户主体</span>
                <select className="filter-select" value={filters.customer} onChange={(e) => updateFilter('customer', e.target.value)}>
                  <option value="">—请选择—</option>
                  <option>华东区客户</option>
                  <option>华南区客户</option>
                  <option>华北区客户</option>
                </select>
              </div>
              <div className="filter-item">
                <span className="filter-item-label">采购员</span>
                <input className="filter-input" type="text" placeholder="请输入" value={filters.buyer} onChange={(e) => updateFilter('buyer', e.target.value)} />
              </div>
              <div className="filter-item">
                <span className="filter-item-label">供应商</span>
                <input className="filter-input" type="text" placeholder="请输入" value={filters.supplier} onChange={(e) => updateFilter('supplier', e.target.value)} />
              </div>
              <div className="filter-item">
                <span className="filter-item-label">发货计划</span>
                <select className="filter-select" value={filters.shipPlan} onChange={(e) => updateFilter('shipPlan', e.target.value)}>
                  <option value="">—请选择—</option>
                  <option>本周</option>
                  <option>下周</option>
                  <option>本月</option>
                </select>
              </div>
              <div className="filter-item">
                <span className="filter-item-label">发货状态</span>
                <select className="filter-select" value={filters.shipStatus} onChange={(e) => updateFilter('shipStatus', e.target.value)}>
                  <option value="">—请选择—</option>
                  <option>未发货</option>
                  <option>已发货</option>
                  <option>部分发货</option>
                </select>
              </div>
            </div>
            <div className="filter-actions">
              <button className="btn btn-ghost" onClick={handleReset}>重置</button>
              <button className="btn btn-primary" onClick={handleSearch}>搜索</button>
            </div>
          </div>
        </div>

        {/* Table Toolbar */}
        <div className="table-toolbar">
          <div className="toolbar-left">
            <span className="total-count">共 <strong>{ordersTotal}</strong> 条订单</span>
            <div style={{ width: 1, height: 14, background: 'var(--color-border)' }} />
            <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}>筛选</button>
            <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}>排序</button>
            <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}>列设置</button>
          </div>
          <div className="toolbar-right">
            <button className="btn btn-outline" style={{ height: 26, fontSize: 11 }}>批量添加至对话</button>
          </div>
        </div>

        {/* Data Table */}
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36, padding: '8px' }}>
                  <input type="checkbox" />
                </th>
                <th style={{ width: 24 }}>#</th>
                <th className="sortable" style={{ width: 130 }}>订单编号 ↕</th>
                <th style={{ width: 80 }}>订单主体</th>
                <th style={{ width: 130 }}>品牌主体</th>
                <th style={{ width: 80 }}>销售员</th>
                <th style={{ width: 80 }}>下单日期</th>
                <th style={{ width: 70 }}>交货期</th>
                <th style={{ width: 90 }}>发货方式</th>
                <th style={{ width: 60 }}>SKU数</th>
                <th className="sortable" style={{ width: 100 }}>订单金额 ↕</th>
                <th style={{ width: 70 }}>签收</th>
                <th style={{ width: 80 }}>发货进度</th>
                <th style={{ width: 70 }}>异常</th>
                <th style={{ width: 90 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {ordersLoading ? (
                <tr><td colSpan={15} style={{ textAlign: 'center', padding: 40, color: 'var(--color-muted)' }}>加载中...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={15} style={{ textAlign: 'center', padding: 40, color: 'var(--color-muted)' }}>暂无数据</td></tr>
              ) : (
                orders.map((r: any, i: number) => (
                  <tr
                    key={r.id}
                    className={cn(r.isException && 'row-exception', selectedOrders.has(r.id) && 'selected')}
                  >
                    <td style={{ padding: '7px' }}>
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(r.id)}
                        onChange={() => toggleOrder(r.id)}
                      />
                    </td>
                    <td style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {String((orderPage - 1) * orderPageSize + i + 1).padStart(2, '0')}
                    </td>
                    <td>
                      <span className="order-num">{r.id}</span>
                    </td>
                    <td>
                      <span className={cn('tag-chip', r.brand?.includes('产品') ? 'blue' : r.brand?.includes('工业') ? 'purple' : r.brand?.includes('工贸') ? 'green' : 'orange')}>
                        {r.brand?.slice(0, 3) || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="company-name" title={r.customer}>{r.customer}</span>
                    </td>
                    <td>{r.salesperson}</td>
                    <td style={{ fontSize: 11, color: 'var(--color-muted)' }}>{r.orderDate}</td>
                    <td style={{ fontSize: 11 }}>{r.deliveryDays}天</td>
                    <td>
                      <span className={cn('badge-pill', r.shipMethod === '直发客户' ? 'badge-info' : 'badge-neutral')}>
                        {r.shipMethod}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{r.skuCount}</td>
                    <td className="amount">{r.amount?.toLocaleString()}</td>
                    <td>
                      <span className={cn('badge-pill', recvClass(r.receiptRatio))}>
                        <span className="badge-dot" />
                        {r.receiptRatio}%
                      </span>
                    </td>
                    <td>
                      <div className="progress-wrap">
                        <div className="progress-bar">
                          <div className={cn('progress-fill', progClass(r.shipmentRatio))} style={{ width: `${r.shipmentRatio}%` }} />
                        </div>
                        <span className="progress-pct">{r.shipmentRatio}%</span>
                      </div>
                    </td>
                    <td>
                      <span className={cn('badge-pill', r.isException ? 'badge-danger' : 'badge-neutral')}>
                        {r.isException ? '异常' : '正常'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className={cn('icon-btn add-to-chat', selectedOrders.has(r.id) && 'added')}
                          title={selectedOrders.has(r.id) ? '已加入（点击移除）' : '加入对话'}
                          onClick={() => toggleOrder(r.id)}
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                            <path d="M10 2H2a1 1 0 00-1 1v6a1 1 0 001 1h1v2l3-2h4a1 1 0 001-1V3a1 1 0 00-1-1zm-4 5H4V6h2V4h1v2h2v1H7v2H6V7z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(() => {
          const totalPages = Math.ceil(ordersTotal / orderPageSize) || 1
          const pages: Array<{ type: 'page' | 'ellipsis'; value: number }> = []
          if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) pages.push({ type: 'page', value: i })
          } else {
            pages.push({ type: 'page', value: 1 })
            if (orderPage > 3) pages.push({ type: 'ellipsis', value: -1 })
            const start = Math.max(2, orderPage - 1)
            const end = Math.min(totalPages - 1, orderPage + 1)
            for (let i = start; i <= end; i++) pages.push({ type: 'page', value: i })
            if (orderPage < totalPages - 2) pages.push({ type: 'ellipsis', value: -2 })
            pages.push({ type: 'page', value: totalPages })
          }
          return (
        <div className="pagination">
          <div className="pagination-info">
            显示 <span style={{ fontFamily: 'var(--font-mono)' }}>{ordersTotal === 0 ? '0–0' : `${(orderPage - 1) * orderPageSize + 1}–${Math.min(orderPage * orderPageSize, ordersTotal)}`}</span> 条，共{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{ordersTotal}</span> 条
          </div>
          <div className="pagination-controls">
            <button
              className="page-btn"
              onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
              disabled={orderPage <= 1}
            >‹</button>
            {pages.map((p) =>
              p.type === 'ellipsis' ? (
                <span key={`e${p.value}`} className="page-ellipsis">…</span>
              ) : (
                <button
                  key={p.value}
                  className={cn('page-btn', orderPage === p.value && 'active')}
                  onClick={() => setOrderPage(p.value)}
                >
                  {p.value}
                </button>
              )
            )}
            <button
              className="page-btn"
              onClick={() => setOrderPage((p) => Math.min(totalPages, p + 1))}
              disabled={orderPage >= totalPages}
            >›</button>
            <div style={{ width: 8 }} />
            <select
              className="page-size-select"
              value={orderPageSize}
              onChange={(e) => { setOrderPageSize(Number(e.target.value)); setOrderPage(1) }}
            >
              <option value={10}>10/页</option>
              <option value={20}>20/页</option>
              <option value={50}>50/页</option>
              <option value={100}>100/页</option>
            </select>
          </div>
        </div>
          )
        })()}
      </div>


      {/* Filter Config Modal */}
      <div className={cn('filter-modal-overlay', showFilterModal && 'show')} onClick={() => setShowFilterModal(false)}>
        <div className="filter-modal" onClick={(e) => e.stopPropagation()}>
          <div className="filter-modal-header">
            <span className="filter-modal-title">配置筛选字段</span>
            <button className="filter-modal-close" onClick={() => setShowFilterModal(false)}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M1.5 1.5l9 9m-9 0l9-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="filter-modal-body">
            {['销售员', '品牌主体', '签收状态', '出库状态', '是否异常', '客户主体', '采购员', '供应商', '发货计划', '发货状态'].map((label, idx) => (
              <div key={label} className="filter-modal-item">
                <div className="filter-modal-check checked">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l3 3L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="filter-modal-num">{String(idx + 1).padStart(2, '0')}</span>
                <span className="filter-modal-label">{label}</span>
              </div>
            ))}
          </div>
          <div className="filter-modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowFilterModal(false)}>取消</button>
            <button className="btn btn-primary" onClick={() => setShowFilterModal(false)}>确定</button>
          </div>
        </div>
      </div>
    </div>
  )
}
