import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import TaskDetailLayout from '../components/TaskDetailLayout'
import { api } from '../lib/api'
import { useChatStore } from '../stores/chatStore'
import { useA2uiStore } from '../stores/a2uiStore'

interface CheckItem {
  id: number
  text: string
  hint: string
  done: boolean
}

const initialChecklist: CheckItem[] = [
  {
    id: 1,
    text: '打印出库单（SF20241202001）',
    hint: '确认出库单包含全部 6 项 SKU，打印时间为 2024/12/02 10:18',
    done: true,
  },
  {
    id: 2,
    text: '核对实物与出库单物料编号',
    hint: '重点核对 HT001241（CCU-2000 控制板）型号、批次、数量',
    done: false,
  },
  {
    id: 3,
    text: '检查包装完整性及防潮标识',
    hint: '铜制品需确认防锈包装完好，湿度指示卡未变色',
    done: false,
  },
  {
    id: 4,
    text: '在系统中确认「实物核对通过」',
    hint: '扫描出库单条码 → 逐项勾选 → 提交复核',
    done: false,
  },
]

const timelineItems = [
  {
    title: '任务分配',
    time: '2024/11/14 11:30 · 系统',
    desc: '由 AI 分析结果自动分配至李明，任务类型：手工任务',
    status: 'completed' as const,
  },
  {
    title: '开始处理',
    time: '2024/11/16 09:15 · 李明',
    desc: '已到达主仓库，开始核对出库单信息',
    status: 'completed' as const,
  },
  {
    title: '步骤 1 完成',
    time: '2024/11/16 09:22 · 李明',
    desc: '已打印出库单，确认包含 6 项 SKU，准备核对实物',
    status: 'active' as const,
  },
]

export default function TaskManualPage() {
  const { id } = useParams()
  const [checklist, setChecklist] = useState(initialChecklist)
  const [skuCount, setSkuCount] = useState('')
  const [materialCode, setMaterialCode] = useState('HT001241')
  const [packageStatus, setPackageStatus] = useState('完好无损')
  const [humidityStatus, setHumidityStatus] = useState('正常（未变色）')
  const [exceptionNote, setExceptionNote] = useState('')
  const [taskData, setTaskData] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    api.tasks.get(id)
      .then((data) => setTaskData(data))
      .catch(() => { /* use defaults */ })
  }, [id])

  const setPageConfig = useChatStore((s) => s.setPageConfig)
  const navigate = useNavigate()
  const a2uiStore = useA2uiStore()

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

  const toggleCheck = (n: number) => {
    setChecklist(prev => prev.map(item => item.id === n ? { ...item, done: !item.done } : item))
  }

  const completedCount = checklist.filter(i => i.done).length

  return (
    <TaskDetailLayout
      title={taskData ? `${taskData.typeLabel} — ${taskData.title}` : '手工任务 — 核对出库单与实物信息'}
      taskId={id}
      contractId={taskData?.contractId}
      task={taskData}
    >
      {/* Manual Status Card */}
      <div className="manual-status-card">
        <div className="manual-status-icon">手</div>
        <div className="agent-status-body">
          <div className="agent-status-title">核对出库单与实物信息</div>
          <div className="agent-status-sub">执行人：李明 · 预计耗时 15 分钟 · 需在 2024/11/17 前完成</div>
        </div>
        <span className="manual-status-badge">进行中</span>
      </div>

      {/* Checklist */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">操作步骤</span>
          <span className="text-[11px] text-muted">已完成 {completedCount} / {checklist.length}</span>
        </div>
        <div className="detail-card-body">
          <div className="manual-checklist">
            {checklist.map((item) => (
              <label
                key={item.id}
                className={`manual-checklist-item ${item.done ? 'done' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => toggleCheck(item.id)}
                  className="manual-checkbox"
                />
                <div className="manual-check-body">
                  <div className="manual-check-text">{item.id}. {item.text}</div>
                  <div className="manual-check-hint">{item.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">填写核对结果</span>
        </div>
        <div className="detail-card-body">
          <div className="manual-form-grid">
            <div className="manual-form-item">
              <label className="manual-form-label">实物 SKU 数量</label>
              <input
                type="text"
                value={skuCount}
                onChange={(e) => setSkuCount(e.target.value)}
                placeholder="请输入"
                className="manual-form-input"
              />
            </div>
            <div className="manual-form-item">
              <label className="manual-form-label">物料编号核对</label>
              <input
                type="text"
                value={materialCode}
                onChange={(e) => setMaterialCode(e.target.value)}
                placeholder="请输入"
                className="manual-form-input"
              />
            </div>
            <div className="manual-form-item">
              <label className="manual-form-label">包装状态</label>
              <select
                value={packageStatus}
                onChange={(e) => setPackageStatus(e.target.value)}
                className="manual-form-input"
              >
                <option>完好无损</option>
                <option>轻微破损</option>
                <option>严重破损</option>
              </select>
            </div>
            <div className="manual-form-item">
              <label className="manual-form-label">防潮标识状态</label>
              <select
                value={humidityStatus}
                onChange={(e) => setHumidityStatus(e.target.value)}
                className="manual-form-input"
              >
                <option>正常（未变色）</option>
                <option>异常（已变色）</option>
              </select>
            </div>
            <div className="manual-form-item full">
              <label className="manual-form-label">异常说明（如有）</label>
              <textarea
                value={exceptionNote}
                onChange={(e) => setExceptionNote(e.target.value)}
                placeholder="请描述核对过程中发现的任何异常"
                className="decision-form-textarea"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Attachment */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">附件上传</span>
        </div>
        <div className="detail-card-body">
          <div className="manual-attach-zone">
            <div className="manual-attach-icon">📎</div>
            <div className="manual-attach-text">点击上传或拖拽文件至此处</div>
            <div className="manual-attach-hint">支持 JPG、PNG、PDF，单个文件不超过 10MB</div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">处理记录</span>
        </div>
        <div className="detail-card-body">
          <div className="timeline">
            {timelineItems.map((item, idx) => (
              <div key={idx} className={`timeline-item ${item.status}`}>
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-title">{item.title}</div>
                  <div className="timeline-time">{item.time}</div>
                  <div className="timeline-desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </TaskDetailLayout>
  )
}
