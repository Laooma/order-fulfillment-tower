import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cn } from '../lib/utils'
import SubNav from '../components/SubNav'
import { api } from '../lib/api'
import { useChatStore } from '../stores/chatStore'
import { A2uiRenderer } from '../components/A2uiRenderer'
import type { A2uiMessageBase } from '../components/A2uiRenderer'
import type { ChatPageConfig } from '../stores/chatStore'

/* ── Types ── */
interface Contract {
  id: string
  number: string
  customer: string
  amount: string
  shipmentRatio: number
  status: string
  statusClass: 'blue' | 'green' | 'orange'
  sales: string
  region: string
  orderDate: string
}

interface IssueCard {
  id: string
  contractId: string
  materialCode: string
  materialName: string
  partName: string
  partNumber: string
  tags: { label: string; variant: 'pill' | 'urgent' | 'normal' }[]
  cardDetail?: CardDetailData | null
}

interface CardDetailData {
  materialInfo: Record<string, string>
  aiAnalysis: string
  deliveryPath: Array<{
    docType: string
    docNo: string
    badge: string
    qty: number
    status: string
    problemPoint: string
  }>
}

interface IssueLane {
  id: string
  name: string
  type: 1 | 2 | 3 | 4
  cards: IssueCard[]
}

interface TodoTask {
  id: string
  category: string
  description: string
  priority: 'high' | 'medium' | 'low'
  assignee: string
  dueDate: string
  status: 'pending' | 'progress' | 'overdue' | 'done'
  taskType: 'agent' | 'decision' | 'manual'
}

/* ── API result type ── */
interface AnalysisFullResult {
  id: string
  title: string
  task_type: string
  agent: string
  status: string
  created_at: string
  a2uiData?: Array<{ type: string; [key: string]: unknown }>
  orders: Array<{
    id: string
    contract_number: string
    customer: string
    amount: string
    shipment_ratio: number
    status: string
    status_class: string
    sales: string
    region: string
    order_date: string
    problemCategories: Array<{
      id: string
      name: string
      type: number
      cards: Array<{
        id: string
        material_code: string
        material_name: string
        part_name: string
        part_number: string
        tags: Array<{ label: string; variant: string }>
      }>
    }>
    todos: Array<{
      id: string
      category: string
      description: string
      priority: string
      assignee: string
      due_date: string
      status: string
      task_type: string
    }>
    deliveryTables: Array<{
      id: string
      title: string
      badge: string
      items: Array<{
        docNo: string
        status: string
        lineNo: string
        sign: string
        qty: number
      }>
    }>
  }>
}

function mapToContracts(orders: AnalysisFullResult['orders']): Contract[] {
  return orders.map((o, i) => ({
    id: o.id || `order-${i}`,
    number: o.contract_number,
    customer: o.customer,
    amount: o.amount,
    shipmentRatio: o.shipment_ratio,
    status: o.status,
    statusClass: (o.status_class || 'blue') as Contract['statusClass'],
    sales: o.sales,
    region: o.region,
    orderDate: o.order_date,
  }))
}

function mapToLanes(categories: AnalysisFullResult['orders'][0]['problemCategories'], contractId: string): IssueLane[] {
  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    type: (cat.type || 1) as IssueLane['type'],
    cards: (cat.cards || []).map((card: any) => ({
      id: card.id,
      contractId,
      materialCode: card.material_code,
      materialName: card.material_name,
      partName: card.part_name,
      partNumber: card.part_number,
      tags: (card.tags || []).map((t: any) => ({
        label: t.label,
        variant: (t.variant || 'pill') as 'pill' | 'urgent' | 'normal',
      })),
      cardDetail: card.cardDetail || null,
    })),
  }))
}

function mapToTodos(todos: AnalysisFullResult['orders'][0]['todos']): TodoTask[] {
  return (todos || []).map((t) => ({
    id: t.id,
    category: t.category,
    description: t.description,
    priority: (t.priority || 'medium') as TodoTask['priority'],
    assignee: t.assignee,
    dueDate: t.due_date,
    status: (t.status || 'pending') as TodoTask['status'],
    taskType: (t.task_type || 'manual') as TodoTask['taskType'],
  }))
}

/* ── Helpers ── */
const todoCategories = ['发货任务', '入库任务', '合同确认', '异常处理']

const lpStatusClass = (c: string) => {
  switch (c) {
    case 'blue': return 'lp-status-blue'
    case 'green': return 'lp-status-green'
    case 'orange': return 'lp-status-orange'
    default: return 'lp-status-blue'
  }
}

const priorityBadge = (p: string) => {
  switch (p) {
    case 'high': return 'badge-pill badge-danger'
    case 'medium': return 'badge-pill badge-warning'
    default: return 'badge-pill badge-neutral'
  }
}

const priorityLabel = (p: string) => {
  switch (p) {
    case 'high': return '高'
    case 'medium': return '中'
    default: return '低'
  }
}

const statusBadge = (s: string) => {
  switch (s) {
    case 'pending': return 'badge-pill badge-info'
    case 'progress': return 'badge-pill badge-success'
    case 'overdue': return 'badge-pill badge-danger'
    case 'done': return 'badge-pill badge-success'
    default: return 'badge-pill badge-neutral'
  }
}

const statusLabel = (s: string) => {
  switch (s) {
    case 'pending': return '待处理'
    case 'progress': return '进行中'
    case 'overdue': return '已逾期'
    case 'done': return '已完成'
    default: return '待处理'
  }
}

const taskDetailPath = (type: string, id: string) => {
  switch (type) {
    case 'agent': return `/task/agent/${id}`
    case 'decision': return `/task/decision/${id}`
    case 'manual': return `/task/manual/${id}`
    default: return `/task/manual/${id}`
  }
}

const kanbanTagClass = (type: number, variant: string) => {
  if (variant === 'urgent') return 'kanban-tag-urgent'
  if (variant === 'normal') return type === 2 ? '' : 'kanban-tag-normal'
  return 'kanban-tag-pill'
}

/* ── Components ── */

function LeftPanel({ contracts, activeContractId, selectedIds, onSelectContract, onToggleSelect, onGenerateTodos, generating, taskInfo, collapsed, onToggleCollapse }: {
  contracts: Contract[]
  activeContractId: string
  selectedIds: Set<string>
  onSelectContract: (id: string) => void
  onToggleSelect: (id: string) => void
  onGenerateTodos: () => void
  generating: boolean
  taskInfo?: { id: string; creator: string; updatedAt: string; status: string } | null
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const selectedCount = selectedIds.size
  const activeContract = contracts.find((c) => c.id === activeContractId)

  if (collapsed) {
    return (
      <aside className="left-panel left-panel-collapsed">
        <button className="lp-collapse-toggle" onClick={onToggleCollapse} title="展开合同清单">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M5 2l6 5-6 5-1-1 5-4-5-4z" />
          </svg>
        </button>

        <div className="lp-collapsed-list">
          {contracts.map((c) => (
            <div
              key={c.id}
              onClick={() => onSelectContract(c.id)}
              className={cn(
                'lp-collapsed-item',
                activeContractId === c.id && 'active',
                selectedIds.has(c.id) && 'selected'
              )}
              title={`${c.number} · ${c.customer} · 发货${c.shipmentRatio}%`}
            >
              <div className="lp-water-tank" style={{ '--fill': `${c.shipmentRatio}%` } as React.CSSProperties}>
                <svg className="lp-water-wave" viewBox="0 0 120 20" preserveAspectRatio="none">
                  <path d="M0 10 Q10 4 20 10 T40 10 T60 10 T80 10 T100 10 T120 10 V20 H0 Z" />
                </svg>
                <div className="lp-water-fill" />
                <span className="lp-water-pct">{c.shipmentRatio}<small>%</small></span>
                {selectedIds.has(c.id) && <span className="lp-water-check" />}
              </div>
              <span className="lp-collapsed-number">{c.number}</span>
            </div>
          ))}
        </div>

        <div className="lp-footer lp-footer-collapsed">
          <button
            className="lp-action-btn lp-action-btn-collapsed"
            disabled={selectedCount === 0 || generating}
            onClick={onGenerateTodos}
            title={`生成待办清单${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {selectedCount > 0 && <span>{selectedCount}</span>}
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="left-panel">
      <div className="lp-header">
        {taskInfo ? (
          <div className="lp-task-info">
            <div className="lp-task-info-row">
              <span className="lp-task-info-label">任务编号</span>
              <span className="lp-task-info-value mono">{taskInfo.id}</span>
            </div>
            <div className="lp-task-info-row">
              <span className="lp-task-info-label">创建人</span>
              <span className="lp-task-info-value">{taskInfo.creator}</span>
              <span className="lp-task-info-label" style={{ marginLeft: 12 }}>更新时间</span>
              <span className="lp-task-info-value">{taskInfo.updatedAt}</span>
            </div>
            <div className="lp-task-info-row">
              <span className="lp-task-info-label">当前状态</span>
              <span className={cn('badge-pill', taskInfo.status === 'completed' ? 'badge-success' : 'badge-info')}>{taskInfo.status === 'completed' ? '已完成' : '执行中'}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="lp-title">
              <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" style={{ opacity: 0.5 }}>
                <path d="M1 1h5v5H1zM8 1h5v5H8zM1 8h5v5H1zM8 8h5v5H8z"/>
              </svg>
              合同待办清单
            </div>
            <div className="lp-sort">
              <span>默认排序</span>
            </div>
          </>
        )}
        <button className="lp-collapse-toggle" onClick={onToggleCollapse} title="收起合同清单">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M5 2l6 5-6 5-1-1 5-4-5-4z" />
          </svg>
        </button>
      </div>

      <div className="lp-list">
        {contracts.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelectContract(c.id)}
            className={cn(
              'lp-item',
              activeContractId === c.id && 'active',
              selectedIds.has(c.id) && 'selected'
            )}
          >
            <input
              type="checkbox"
              className="lp-item-check"
              checked={selectedIds.has(c.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(c.id)}
            />
            <div className="lp-item-body">
              <div className="lp-item-id">{c.number}</div>
              <div className="lp-item-meta">{c.customer}</div>
              <div className="lp-item-progress">
                <div className="lp-item-progress-label">
                  <span>发货比例</span>
                  <strong>{c.shipmentRatio}%</strong>
                </div>
                <div className="lp-item-progress-bar">
                  <div className="lp-item-progress-fill" style={{ width: `${c.shipmentRatio}%` }} />
                </div>
              </div>
            </div>
            <span className={cn('lp-item-status', lpStatusClass(c.statusClass))}>
              {c.status}
            </span>
          </div>
        ))}
      </div>

      <div className="lp-footer">
        <button
          className="lp-action-btn"
          disabled={selectedCount === 0 || generating}
          onClick={onGenerateTodos}
        >
          {generating ? '生成中...' : `生成待办清单${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
        </button>
      </div>
    </aside>
  )
}

function KanbanCard({ card, type, onClick }: { card: IssueCard; type: number; onClick: () => void }) {
  return (
    <div onClick={onClick} className="kanban-card">
      <div className="kanban-card-id">
        {card.materialCode}
      </div>
      <div className="kanban-card-text">
        {card.materialName} · {card.partName} · 编号：{card.partNumber}
      </div>
      <div className="kanban-card-tags">
        {card.tags.map((tag, i) => (
          <span
            key={i}
            className={cn('kanban-card-tag', kanbanTagClass(type, tag.variant))}
          >
            {tag.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function KanbanView({ contract, lanes, onCardClick, taskId }: {
  contract: Contract
  lanes: IssueLane[]
  onCardClick: (card: IssueCard) => void
  taskId?: string
}) {
  const metrics = [
    { label: '预约比例', value: '0%' },
    { label: '服务比例', value: '0%' },
    { label: '出库比例', value: '0%' },
    { label: '结算比例', value: '0%' },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="title-card">
        <div className="title-card-left">
          <div className="title-card-logo">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="#fff" opacity="0.9">
              <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z"/>
            </svg>
          </div>
          <div className="title-card-info">
            <h2>{contract.customer} {contract.region}</h2>
            <p>合同编号：{contract.number} · {contract.orderDate} 下单 · 销售员：{contract.sales}{taskId ? ` · 分析任务：${taskId}` : ''}</p>
          </div>
        </div>
        <div className="title-card-amount">
          <div className="amt">{contract.amount}</div>
          <div className="amt-label">万元</div>
        </div>
      </div>

      <div className="metrics-row">
        {metrics.map((m) => (
          <div key={m.label} className="metric-card">
            <div className="metric-card-label">{m.label}</div>
            <div className="metric-card-value">{m.value}</div>
            <div className="metric-card-bar">
              <div className="metric-card-fill" style={{ width: '0%' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="kanban-board">
        {lanes.map((lane) => (
          <div key={lane.id} className={cn('kanban-col', `type${lane.type}`)}>
            <div className="kanban-col-header">
              <span className="kanban-col-title">{lane.name}</span>
              <span className="kanban-col-count">{lane.cards.length}</span>
            </div>
            <div className="kanban-col-body">
              {lane.cards.map((card) => (
                <KanbanCard
                  key={card.id}
                  card={card}
                  type={lane.type}
                  onClick={() => onCardClick(card)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TodoListView({ tasks }: { tasks: TodoTask[] }) {
  const handleOpenTask = (taskType: string, taskId: string) => {
    const path = taskDetailPath(taskType, taskId)
    window.open(path, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto p-2.5 gap-2.5">
      {todoCategories.map((cat) => {
        const catTasks = tasks.filter((t) => t.category === cat)
        if (catTasks.length === 0) return null
        return (
          <div key={cat} className="detail-card">
            <div className="detail-card-header">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                <span className="w-[3px] h-3.5 bg-accent rounded-sm" />
                {cat}
              </div>
              <span className="badge-pill badge-neutral">{catTasks.length}</span>
            </div>
            <div className="detail-card-body" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>任务编号</th>
                    <th>任务说明</th>
                    <th>优先级</th>
                    <th>负责人</th>
                    <th>截止日期</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {catTasks.map((t) => (
                    <tr key={t.id}>
                      <td><span className="order-num">{t.id}</span></td>
                      <td><div className="desc-cell" title={t.description}>{t.description}</div></td>
                      <td><span className={priorityBadge(t.priority)}>{priorityLabel(t.priority)}</span></td>
                      <td>{t.assignee}</td>
                      <td>{t.dueDate}</td>
                      <td><span className={statusBadge(t.status)}>{statusLabel(t.status)}</span></td>
                      <td>
                        <div className="td-actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button onClick={() => handleOpenTask(t.taskType, t.id)} className="order-num">处理</button>
                          {t.status !== 'done' && (
                            <>
                              <span style={{ color: 'var(--color-border)' }}>|</span>
                              <button
                                className="order-num"
                                style={{ color: 'var(--color-success)' }}
                                onClick={() => {
                                  const storeSendMessage = useChatStore.getState().sendMessage
                                  if (!storeSendMessage) return
                                  storeSendMessage(`请使用 mark_task_complete 工具验证任务 ${t.id}（${t.description}）是否真正完成，验证后发送飞书通知`)
                                }}
                              >
                                标记完成
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KanbanDetailView({ activeCard }: { activeCard: IssueCard | null }) {
  if (!activeCard) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted gap-3">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
        <p className="text-sm">请点击左侧看板中的问题卡片</p>
        <p className="text-xs">查看物料的详细分析信息</p>
      </div>
    )
  }

  const detail = activeCard.cardDetail
  const materialInfo = detail?.materialInfo || {}
  const deliveryPath = detail?.deliveryPath || []

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Material Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <div className="detail-header-id">{activeCard.materialCode}</div>
          <div className="detail-header-sub">{activeCard.materialName} · {activeCard.partName}</div>
        </div>
        <div className="detail-header-actions">
          <div className="detail-header-badge">{activeCard.partNumber}</div>
        </div>
      </div>

      {/* Material General Info */}
      <div className="detail-data-list">
        {(Object.keys(materialInfo).length > 0
          ? Object.entries(materialInfo)
          : [
              ['需求属性', activeCard.materialName || '--'],
              ['需求类别', '产品型'],
              ['品牌', activeCard.materialCode || '--'],
              ['需求系列描述', activeCard.partName || '--'],
              ['需求定制产品', '定制'],
              ['发货方式', '直发客户'],
            ]
        ).map(([label, value], i, arr) => (
          <div
            key={i}
            className="detail-data-row"
            style={i < arr.length - 1 ? { borderBottom: '1px solid oklch(93% 0.015 240)' } : undefined}
          >
            <span className="detail-data-label">{label}</span>
            <span className="detail-data-value">{value}</span>
          </div>
        ))}
      </div>

      {/* AI Analysis */}
      <div className="detail-text-section">
        <div className="detail-text-title">AI 分析结果</div>
        <div className="detail-text-body">
          {detail?.aiAnalysis || '暂无 AI 分析结果。请在"开始工作"页签中发起分析任务。'}
        </div>
      </div>

      {/* Delivery Path with Problem Points */}
      {deliveryPath.length > 0 && (
        <div className="detail-text-section">
          <div className="detail-text-title">交付路径与问题卡点</div>
          {deliveryPath.map((doc, di) => (
            <div key={di} className="delivery-table-card">
              <div className="delivery-table-header">
                <span>{doc.docType}</span>
                <span className="detail-header-badge">{doc.badge}</span>
              </div>
              <table className="delivery-table">
                <thead>
                  <tr>
                    <th>单据编号</th>
                    <th>数量</th>
                    <th>状态</th>
                    <th>问题卡点</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{doc.docNo}</td>
                    <td>{doc.qty}</td>
                    <td>{doc.status}</td>
                    <td>
                      <span className={doc.problemPoint ? 'badge-pill badge-warning' : 'badge-pill badge-neutral'}>
                        {doc.problemPoint || '无'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Fallback: legacy delivery tables if no card detail */}
      {!detail && (
        <div className="detail-text-section">
          <div className="detail-text-title">交付路径展示</div>
          <div className="detail-text-body" style={{ color: 'var(--color-muted)', fontSize: '12px' }}>
            暂无交付路径数据
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Loading / Empty States ── */

function EmptyKanbanState({ taskId }: { taskId?: string }) {
  return (
    <div className="flex flex-col flex-1 items-center justify-center text-muted gap-3">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      <p className="text-sm">暂无分析结果</p>
      <p className="text-xs">
        {taskId ? '请在右侧 AI 助手面板中发起 AI 分析' : '请先创建分析任务'}
      </p>
    </div>
  )
}

function EmptyTodoState() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center text-muted gap-3">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
      <p className="text-sm">暂无待办任务</p>
      <p className="text-xs">点击「生成待办清单」按钮创建执行任务</p>
    </div>
  )
}

/* ── Main Page ── */
export default function AnalysisResultPage() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  type PaneKey = 'kanban' | 'todo' | 'cardDetail' | 'a2ui'
  const [view, setView] = useState<PaneKey>('kanban')
  const [activeContractId, setActiveContractId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeCard, setActiveCard] = useState<IssueCard | null>(null)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  // Split pane state
  const [splitState, setSplitState] = useState<{ left: PaneKey; right: PaneKey } | null>(null)
  const [splitRatio, setSplitRatio] = useState(2 / 3) // left:right = 2:1
  const [dragOverZone, setDragOverZone] = useState<'left' | 'right' | null>(null)
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartRatio = useRef(2 / 3)
  const mainAreaRef = useRef<HTMLDivElement>(null)
  // Data state
  const [contracts, setContracts] = useState<Contract[]>([])
  const [lanesMap, setLanesMap] = useState<Map<string, IssueLane[]>>(new Map())
  const [todosMap, setTodosMap] = useState<Map<string, TodoTask[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [generatingTodos, setGeneratingTodos] = useState(false)
  const [taskInfo, setTaskInfo] = useState<{ id: string; creator: string; updatedAt: string; status: string; skillId?: string; skillName?: string } | null>(null)

  // A2UI analysis result surface state
  const [a2uiSurfaces, setA2uiSurfaces] = useState<{ title: string; messages: A2uiMessageBase[] } | null>(null)

  // Clear A2UI surfaces when task changes
  useEffect(() => {
    setA2uiSurfaces(null)
  }, [taskId])

  // Keep useChatStore for sendMessage access in handleGenerateTodos

  const fetchData = useCallback(async () => {
    if (!taskId) { setLoading(false); return }
    try {
      const result: AnalysisFullResult = await api.analysis.full(taskId)
      if (result && result.orders) {
        const cs = mapToContracts(result.orders)
        setContracts(cs)

        const lMap = new Map<string, IssueLane[]>()
        const tMap = new Map<string, TodoTask[]>()

        result.orders.forEach((order, i) => {
          const cId = order.id || `order-${i}`
          lMap.set(cId, mapToLanes(order.problemCategories, cId))
          tMap.set(cId, mapToTodos(order.todos))
        })

        setLanesMap(lMap)
        setTodosMap(tMap)

        if (cs.length > 0 && !activeContractId) {
          setActiveContractId(cs[0].id)
        }
      }
      // Load persisted A2UI data if available
      if (result.a2uiData && Array.isArray(result.a2uiData) && result.a2uiData.length > 0) {
        setA2uiSurfaces({ title: result.title || 'AI分析结果', messages: result.a2uiData as A2uiMessageBase[] })
      }
    } catch {
      // No results yet — that's OK
    } finally {
      setLoading(false)
    }
  }, [taskId])

  const fetchStatus = useCallback(async () => {
    if (!taskId) return
    try {
      const res = await api.analysis.status(taskId)
      if (res.status) {
        // Auto-switch to todo view when todos are generated
        if (res.status === 'todos_generated' || res.status === 'completed') {
          setGeneratingTodos(false)
          setView('todo')
        }
      }
    } catch { /* ignore */ }
  }, [taskId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Deep-link: auto-open chat when URL has ?chat=1&prompt=...
  useEffect(() => {
    const chatParam = searchParams.get('chat')
    const promptParam = searchParams.get('prompt')
    if (chatParam !== '1' || !promptParam) return

    // Wait for chatStore.sendMessage to be registered by ChatPanel
    let attempts = 0
    const maxAttempts = 20
    const timer = setInterval(() => {
      attempts++
      const storeSendMessage = useChatStore.getState().sendMessage
      if (storeSendMessage) {
        clearInterval(timer)
        storeSendMessage(promptParam)
        // Clean query params from URL after triggering
        const newParams = new URLSearchParams(searchParams)
        newParams.delete('chat')
        newParams.delete('prompt')
        setSearchParams(newParams, { replace: true })
      } else if (attempts >= maxAttempts) {
        clearInterval(timer)
      }
    }, 300)
    return () => clearInterval(timer)
  }, [searchParams.get('chat'), searchParams.get('prompt')])

  // Re-fetch when analysis completes
  const handleAnalysisComplete = useCallback((analysisId: string) => {
    fetchData()
    setTimeout(() => fetchStatus(), 1000)
  }, [fetchData, fetchStatus])

  // Register page config so ChatPanel can deliver a2ui_surface / analysisComplete to this page
  const setPageConfig = useChatStore((s) => s.setPageConfig)
  const splitStateRef = useRef(splitState)
  splitStateRef.current = splitState
  useEffect(() => {
    const cfg: ChatPageConfig = {
      page: 'analysis',
      taskId: taskId || undefined,
      defaultSkillId: taskInfo?.skillId || undefined,
      defaultSkillName: taskInfo?.skillName || undefined,
      onAnalysisComplete: handleAnalysisComplete,
      onA2uiSurface: (data: { title: string; messages: unknown[] }) => {
        setA2uiSurfaces({ title: data.title, messages: data.messages as A2uiMessageBase[] })
        const currentSplit = splitStateRef.current
        if (currentSplit) {
          // In split mode: put a2ui in the right pane
          if (currentSplit.right !== 'a2ui') {
            setSplitState({ left: currentSplit.left, right: 'a2ui' })
          }
        } else {
          setView('a2ui')
        }
      },
    }
    setPageConfig(cfg)
    return () => { setPageConfig(null) }
  }, [taskId, taskInfo?.skillId, taskInfo?.skillName, handleAnalysisComplete, setPageConfig])

  // Fetch task info for LeftPanel header
  useEffect(() => {
    if (!taskId) {
      setTaskInfo(null)
      return
    }
    api.analysis.get(taskId)
      .then((data) => {
        setTaskInfo({
          id: data.id || taskId,
          creator: data.initiator || '—',
          updatedAt: data.completedAt || data.createdAt || '—',
          status: data.status || 'analyzing',
          skillId: data.skillId || '',
          skillName: data.skillName || '',
        })
      })
      .catch(() => {
        setTaskInfo({
          id: taskId,
          creator: '系统',
          updatedAt: new Date().toLocaleDateString('zh-CN'),
          status: 'analyzing',
        })
      })
  }, [taskId])

  // Update detail view when active card changes
  // (KanbanDetailView is no longer rendered in the ChatPanel)

  const activeContract = contracts.find((c) => c.id === activeContractId) || contracts[0]
  const activeLanes = activeContract ? (lanesMap.get(activeContract.id) || []) : []
  const activeTodos = activeContract ? (todosMap.get(activeContract.id) || []) : []
  const activeHasTodos = activeTodos.length > 0
  const effectiveView = (() => {
    if (view === 'todo' && !activeHasTodos) return 'kanban'
    if (view === 'cardDetail' && !activeCard) return 'kanban'
    return view
  })()

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCardClick = (card: IssueCard) => {
    setActiveCard(card)
    if (!splitState) {
      setSplitState({ left: 'kanban', right: 'cardDetail' })
    } else if (splitState.left !== 'cardDetail' && splitState.right !== 'cardDetail') {
      setSplitState({ left: splitState.left, right: 'cardDetail' })
    }
  }

  // Split pane resize (ratio-based)
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return
      const parent = mainAreaRef.current
      if (!parent) return
      const parentWidth = parent.offsetWidth
      const delta = e.clientX - resizeStartX.current
      const deltaRatio = delta / parentWidth
      const newRatio = Math.min(0.75, Math.max(0.25, resizeStartRatio.current + deltaRatio))
      setSplitRatio(newRatio)
    }
    function onMouseUp() {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleSplitResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartRatio.current = splitRatio
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleClosePane = (side: 'left' | 'right') => {
    if (!splitState) return
    const keep = side === 'left' ? splitState.right : splitState.left
    setSplitState(null)
    if (keep === 'cardDetail' && !activeCard) {
      setView('kanban')
    } else {
      setView(keep)
    }
  }

  // Drag and drop from SubNav
  const handleTabDragStart = (key: string) => {
    // drag is handled by SubNav component via HTML5 DnD
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const zone: 'left' | 'right' = x < rect.width / 2 ? 'left' : 'right'
    setDragOverZone(zone)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragOverZone(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverZone(null)
    const tabKey = e.dataTransfer.getData('text/plain') as PaneKey
    if (!tabKey) return
    const rect = e.currentTarget.getBoundingClientRect()
    const zone: 'left' | 'right' = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right'

    if (zone === 'left') {
      setSplitState({ left: tabKey, right: effectiveView === tabKey ? (tabKey === 'kanban' ? 'todo' : 'kanban') : effectiveView })
    } else {
      setSplitState({ left: effectiveView === tabKey ? (tabKey === 'kanban' ? 'todo' : 'kanban') : effectiveView, right: tabKey })
    }
  }

  const handleGenerateTodos = () => {
    if (selectedIds.size === 0 || !taskId) return
    const selectedContracts = contracts
      .filter((c) => selectedIds.has(c.id))
      .map((c) => c.number)
    setGeneratingTodos(true)

    // Safety timeout: reset generating state after 60s to prevent perpetual hang
    const safetyTimer = setTimeout(() => {
      setGeneratingTodos(false)
    }, 60_000)

    const storeSendMessage = useChatStore.getState().sendMessage
    if (!storeSendMessage) {
      setGeneratingTodos(false)
      clearTimeout(safetyTimer)
      return
    }
    storeSendMessage(
      `请为以下合同生成待办清单：${selectedContracts.join('、')}`,
      { taskId, orders: selectedContracts },
    )
  }

  const paneLabel = (k: PaneKey) => {
    switch (k) {
      case 'kanban': return '看板分析'
      case 'todo': return '合同待办清单'
      case 'cardDetail': return '卡片详情'
      case 'a2ui': return a2uiSurfaces?.title || 'AI分析结果'
    }
  }

  const renderPaneContent = (k: PaneKey) => {
    switch (k) {
      case 'a2ui':
        return a2uiSurfaces ? (
          <div className="flex-1 overflow-auto p-4">
            <A2uiRenderer messages={a2uiSurfaces.messages} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">暂无AI分析结果</div>
        )
      case 'kanban':
        return hasData && activeContract ? (
          <KanbanView contract={activeContract} lanes={activeLanes} onCardClick={handleCardClick} taskId={taskId} />
        ) : (
          <EmptyKanbanState taskId={taskId} />
        )
      case 'todo':
        return activeTodos.length > 0 ? (
          <TodoListView tasks={activeTodos} />
        ) : (
          <EmptyTodoState />
        )
      case 'cardDetail':
        return <KanbanDetailView activeCard={activeCard} />
    }
  }

  const renderSplitPane = (side: 'left' | 'right') => {
    if (!splitState) return null
    const k = splitState[side]
    return (
      <div className="split-pane" style={side === 'left' ? { width: `${splitRatio * 100}%`, flexShrink: 0 } : { flex: 1 }}>
        <div className="split-pane-header">
          <span className="split-pane-header-label">{paneLabel(k)}</span>
          <button className="split-pane-close" onClick={() => handleClosePane(side)} title="关闭分屏">×</button>
        </div>
        <div className="split-pane-body">
          {renderPaneContent(k)}
        </div>
      </div>
    )
  }

  const hasData = contracts.length > 0

  return (
    <div className="h-full flex overflow-hidden rounded-xl bg-bg">
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted text-sm">加载中...</div>
      ) : (
        <>
          <LeftPanel
            contracts={contracts}
            activeContractId={activeContractId}
            selectedIds={selectedIds}
            onSelectContract={setActiveContractId}
            onToggleSelect={toggleSelect}
            onGenerateTodos={handleGenerateTodos}
            generating={generatingTodos}
            taskInfo={taskInfo}
            collapsed={leftPanelCollapsed}
            onToggleCollapse={() => setLeftPanelCollapsed((v) => !v)}
          />

          <div className="flex-1 flex flex-col overflow-hidden bg-bg">
            <SubNav
              items={[
                { key: 'kanban', label: '看板分析' },
                { key: 'cardDetail', label: '卡片详情', hidden: !activeCard },
                { key: 'todo', label: '合同待办清单', hidden: !activeHasTodos },
                { key: 'a2ui', label: a2uiSurfaces?.title || 'AI分析结果', hidden: !a2uiSurfaces },
              ]}
              activeKey={splitState ? splitState.left : effectiveView}
              onChange={(k) => {
                setSplitState(null)
                setView(k as PaneKey)
              }}
              onTabDragStart={handleTabDragStart}
            />
            <div
              className="flex-1 flex flex-col overflow-hidden relative"
              ref={mainAreaRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {splitState ? (
                <div className="flex flex-1 overflow-hidden">
                  {renderSplitPane('left')}
                  <div className="panel-resize-handle" onMouseDown={handleSplitResizeStart} title="拖动调整面板宽度" />
                  {renderSplitPane('right')}
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {renderPaneContent(effectiveView)}
                </div>
              )}
              {dragOverZone && (
                <div
                  className="split-drop-zone"
                  style={dragOverZone === 'left' ? { right: '50%' } : { left: '50%' }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
