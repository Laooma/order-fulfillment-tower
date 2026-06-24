import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TaskDetailLayout from '../components/TaskDetailLayout'
import ExecutionTimeline from '../components/ExecutionTimeline'
import CurrentStepPanel from '../components/CurrentStepPanel'
import TaskHandoverModal from '../components/TaskHandoverModal'
import MasterDetailTable from '../components/common/MasterDetailTable'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useA2uiStore } from '../stores/a2uiStore'
import type { ExecutionTask, ExecutionStep } from '../types'
import type { Column } from '../components/common/DataTable'

interface MaterialRow {
  id: string
  material_code: string
  material_name: string
  spec: string
  required_qty: number
  current_stock: number
  shortage_qty: number
  kit_status: string
}

export default function ExecutionTaskPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [task, setTask] = useState<ExecutionTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState<ExecutionStep | null>(null)
  const [showHandover, setShowHandover] = useState(false)
  const [handoverRecords, setHandoverRecords] = useState<any[]>([])
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [dailyBalance, setDailyBalance] = useState<Record<string, any[]>>({})

  const currentUser = useAuthStore((s) => s.user)
  const currentUserName = currentUser?.display_name || ''
  const sendMessage = useChatStore((s) => s.sendMessage)
  const setPageConfig = useChatStore((s) => s.setPageConfig)
  const a2uiStore = useA2uiStore()

  const loadTask = async () => {
    if (!id) return
    try {
      const data = await api.executionTasks.get(id)
      setTask(data)
      const pending = data.steps?.find((s: ExecutionStep) => s.status !== 'done') || data.steps?.[data.steps.length - 1]
      setCurrentStep(pending || null)

      // Load handover records
      api.executionTasks.handovers(id).then((res) => setHandoverRecords(res.data)).catch(() => {})

      // Load order-related materials if contract_number exists
      if (data.contract_number) {
        loadOrderMaterials(data.contract_number)
      }
    } catch (err) {
      console.error('Load execution task error:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadOrderMaterials = async (contractId: string) => {
    try {
      const res = await api.bizContracts.kitCheck(contractId)
      const mats = (res.materials || res.data?.materials || []) as MaterialRow[]
      setMaterials(mats)

      // Load daily balance for first material
      if (mats.length > 0) {
        const first = mats[0]
        if (first.id) {
          const balRes = await api.bizMaterials.dailyBalance(first.id)
          const list = (balRes.dailyBalances || balRes.data?.dailyBalances || balRes.data || balRes || []) as any[]
          setDailyBalance({ [first.id]: list })
        }
      }
    } catch (err) {
      console.error('Load order materials error:', err)
    }
  }

  useEffect(() => {
    loadTask()
  }, [id])

  useEffect(() => {
    setPageConfig({
      page: 'task',
      taskId: id,
      onA2uiSurface: (data: { title: string; messages: unknown[] }) => {
        a2uiStore.setSurface(data.title, data.messages as any[])
        navigate('/a2ui')
      },
    })
    return () => {
      setPageConfig(null)
    }
  }, [id, setPageConfig, navigate, a2uiStore])

  const isDone = task?.status === 'done'

  const handleMarkComplete = () => {
    if (!sendMessage || !id) return
    sendMessage(`请使用 mark_task_complete 工具验证执行任务 ${id}（${task?.title}）是否真正完成，验证后发送飞书通知`)
  }

  const handleStepUpdated = () => {
    loadTask()
  }

  const handleStepClick = (step: ExecutionStep) => {
    setCurrentStep(step)
  }

  const materialColumns: Column<MaterialRow>[] = [
    { key: 'material_code', title: '物料编码', width: 120 },
    { key: 'material_name', title: '物料名称' },
    { key: 'spec', title: '规格', width: 120 },
    { key: 'required_qty', title: '需求数量', width: 80, align: 'right' },
    { key: 'current_stock', title: '当前库存', width: 80, align: 'right' },
    { key: 'shortage_qty', title: '缺口', width: 80, align: 'right' },
    {
      key: 'kit_status',
      title: '齐套状态',
      width: 90,
      render: (v) => (
        <span className={cn('badge-pill', v === '已齐套' ? 'success' : v === '部分齐套' ? 'warning' : 'danger')}>
          {v}
        </span>
      ),
    },
  ]

  const balanceColumns: Column<any>[] = [
    { key: 'date', title: '日期', width: 110 },
    { key: 'supply_qty', title: '到货', width: 70, align: 'right' },
    { key: 'demand_qty', title: '消耗', width: 70, align: 'right' },
    { key: 'balance', title: '当日结余', width: 80, align: 'right' },
    { key: 'cumulative_balance', title: '累计结余', width: 80, align: 'right' },
    { key: 'note', title: '备注' },
  ]

  const taskInfo = useMemo(() => {
    if (!task) return null
    return {
      ...task,
      contractId: task.contract_number,
      dueDate: task.due_date,
    }
  }, [task])

  // Compact summary row shown in header bar
  const summaryNode = useMemo(() => {
    if (!task) return null
    return (
      <>
        <div>
          <div className="info-item-label">任务编号</div>
          <div className="info-item-value mono">{task.id}</div>
        </div>
        <div>
          <div className="info-item-label">关联合同</div>
          <div className="info-item-value">{task.contract_number || '—'}</div>
        </div>
        <div>
          <div className="info-item-label">待办人</div>
          <div className="info-item-value">{task.assignee}</div>
        </div>
        <div>
          <div className="info-item-label">督办人</div>
          <div className="info-item-value">{task.supervisor || '—'}</div>
        </div>
        <div>
          <div className="info-item-label">优先级</div>
          <div className="info-item-value">{task.priorityLabel}</div>
        </div>
        <div>
          <div className="info-item-label">截止日期</div>
          <div className={cn('info-item-value', task.status === 'overdue' && 'text-danger')}>{task.due_date || '—'}</div>
        </div>
      </>
    )
  }, [task])

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted text-sm">
        加载中...
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted text-sm">
        任务不存在或已被删除
      </div>
    )
  }

  return (
    <TaskDetailLayout
      title={`执行任务 — ${task.title}`}
      taskId={id}
      contractId={task.contract_number}
      task={taskInfo}
      onHandover={() => setShowHandover(true)}
      summary={summaryNode}
    >
      {/* Done overlay */}
      {isDone && (
        <div className="detail-done-overlay">
          <div className="detail-done-icon">✓</div>
          <div className="detail-done-text">此任务已完成</div>
          <div className="detail-done-sub">所有操作已锁定，仅供查看</div>
        </div>
      )}

      {/* Timeline */}
      <ExecutionTimeline
        steps={task.steps || []}
        currentStepId={currentStep?.id}
        onStepClick={handleStepClick}
      />

      {/* Current step action panel */}
      {currentStep && (
        <CurrentStepPanel
          task={task}
          step={currentStep}
          currentUserName={currentUserName}
          onStepUpdated={handleStepUpdated}
        />
      )}

      {/* Task details: master-detail table */}
      {materials.length > 0 && (
        <div className="detail-card flex flex-col" style={{ minHeight: 360 }}>
          <div className="detail-card-header">
            <span className="detail-card-title">任务详情数据</span>
            <span className="text-[11px] text-muted">左：物料清单 · 右：日结余明细</span>
          </div>
          <div className="detail-card-body flex-1 overflow-hidden">
            <MasterDetailTable<MaterialRow, any>
              masterColumns={materialColumns}
              detailColumns={balanceColumns}
              masterData={materials}
              masterKey="id"
              detailKey="id"
              masterWidth="45%"
              loadDetailData={async (record) => {
                if (!dailyBalance[record.id]) {
                  try {
                    const res = await api.bizMaterials.dailyBalance(record.id)
                    const list = (res.dailyBalances || res.data?.dailyBalances || res.data || res || []) as any[]
                    setDailyBalance((prev) => ({ ...prev, [record.id]: list }))
                    return list
                  } catch {
                    return []
                  }
                }
                return dailyBalance[record.id]
              }}
            />
          </div>
        </div>
      )}

      {/* Handover records */}
      {handoverRecords.length > 0 && (
        <div className="detail-card">
          <div className="detail-card-header">
            <span className="detail-card-title">移交记录</span>
          </div>
          <div className="detail-card-body">
            <div className="space-y-2">
              {handoverRecords.map((record) => (
                <div key={record.id} className="text-sm border-l-2 border-border pl-3 py-1">
                  <div className="text-fg">
                    {record.from_user} → {record.to_user}
                    {record.handed_by && <span className="text-muted ml-2">（经办：{record.handed_by}）</span>}
                  </div>
                  {record.reason && <div className="text-xs text-muted mt-0.5">原因：{record.reason}</div>}
                  <div className="text-[11px] text-muted mt-0.5">{record.created_at}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showHandover && (
        <TaskHandoverModal
          taskId={task.id}
          currentAssignee={task.assignee}
          currentUserName={currentUserName}
          onClose={() => setShowHandover(false)}
          onHandovered={loadTask}
        />
      )}
    </TaskDetailLayout>
  )
}

