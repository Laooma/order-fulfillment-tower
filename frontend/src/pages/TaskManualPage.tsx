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
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)

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
      defaultSkillId: taskData?.skillId || undefined,
      defaultSkillName: taskData?.skillName || undefined,
      onA2uiSurface: (data: { title: string; messages: unknown[] }) => {
        a2uiStore.setSurface(data.title, data.messages as any[])
        navigate('/a2ui')
      },
    })
    return () => {
      setPageConfig(null)
    }
  }, [id, taskData?.skillId, taskData?.skillName, setPageConfig, navigate, a2uiStore])

  const toggleCheck = (n: number) => {
    setChecklist(prev => prev.map(item => item.id === n ? { ...item, done: !item.done } : item))
  }

  const handleSubmitCheckResult = async () => {
    setSubmitting(true)
    setSubmitResult(null)
    try {
      // Extract material code from task description (e.g. PL-002, KG-003, SDR-240-24, HT001241)
      const desc = taskData?.description || ''
      const codeMatch = desc.match(/\b([A-Z]{2,4}-\d{2,4}(?:-[A-Za-z0-9]+)?|HT\d{6})\b/i)
      const extractedCode = codeMatch ? codeMatch[1] : materialCode

      // Search for the material
      const contractNo = taskData?.contractId || ''
      const enteredStock = Number(skuCount)
      const searchResult = await api.bizMaterials.search(extractedCode)

      if (!searchResult?.contracts?.length) {
        // Material not found — try to auto-create it via upsert
        if (enteredStock > 0 && contractNo) {
          const upsertResult = await api.bizMaterials.upsert({
            contractNo,
            materialCode: extractedCode,
            materialName: extractedCode,
            currentStock: enteredStock,
          })
          if (upsertResult?.success) {
            setSubmitResult({
              success: true,
              message: `已自动创建物料「${extractedCode}」并写入库存 ${enteredStock}，合同 ${contractNo}`,
            })
            return
          }
        }
        const suggestions = (searchResult as any)?.suggestedCodes
        const hint = suggestions?.length
          ? `\n可用物料编码：${suggestions.slice(0, 10).join('、')}${suggestions.length > 10 ? '...' : ''}`
          : ''
        setSubmitResult({ success: false, message: `未找到物料编码「${extractedCode}」的库存记录。${hint}` })
        return
      }

      // Find ALL matching entries for this material + contract
      const matchingEntries = searchResult.contracts.filter(
        (c: any) => c.contractNo === contractNo
      )

      if (matchingEntries.length === 0) {
        // Found in other contracts but not this one — auto-create under this contract
        if (enteredStock > 0 && contractNo) {
          const upsertResult = await api.bizMaterials.upsert({
            contractNo,
            materialCode: extractedCode,
            materialName: extractedCode,
            currentStock: enteredStock,
          })
          if (upsertResult?.success) {
            setSubmitResult({
              success: true,
              message: `已为合同 ${contractNo} 创建物料「${extractedCode}」并写入库存 ${enteredStock}`,
            })
            return
          }
        }
        setSubmitResult({ success: false, message: `未找到物料 ${extractedCode} 在合同 ${contractNo} 中的记录` })
        return
      }

      // Update all matching entries proportionally based on requiredQty
      const totalRequired = matchingEntries.reduce((sum: number, e: any) => sum + e.requiredQty, 0)
      let updatedCount = 0
      for (const entry of matchingEntries) {
        const proportion = totalRequired > 0 ? entry.requiredQty / totalRequired : 1 / matchingEntries.length
        const targetStock = Math.round(enteredStock * proportion)
        await api.bizMaterials.updateStock(entry.materialId, targetStock)
        updatedCount++
      }

      setSubmitResult({ success: true, message: `物料 ${extractedCode} 的 ${updatedCount} 条库存记录已更新，合同 ${contractNo} 各条目按需求比例分配库存` })
    } catch (err: any) {
      setSubmitResult({ success: false, message: err.message || '更新失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const completedCount = checklist.filter(i => i.done).length
  const isDone = taskData?.status === 'done'

  return (
    <TaskDetailLayout
      title={taskData ? `${taskData.typeLabel} — ${taskData.title}` : '手工任务 — 核对出库单与实物信息'}
      taskId={id}
      contractId={taskData?.contractId}
      task={taskData}
    >
      {/* Done overlay banner */}
      {isDone && (
        <div className="detail-done-overlay">
          <div className="detail-done-icon">✓</div>
          <div className="detail-done-text">此任务已完成</div>
          <div className="detail-done-sub">所有操作已锁定，仅供查看</div>
        </div>
      )}

      {/* Manual Status Card */}
      <div className="manual-status-card">
        <div className="manual-status-icon">手</div>
        <div className="agent-status-body">
          <div className="agent-status-title">核对出库单与实物信息</div>
          <div className="agent-status-sub">执行人：李明 · 预计耗时 15 分钟 · 需在 2024/11/17 前完成</div>
        </div>
        <span className={`manual-status-badge ${isDone ? 'done' : ''}`}>{isDone ? '已完成' : '进行中'}</span>
      </div>

      {/* Task Description */}
      {taskData?.description && (
        <div className="detail-card">
          <div className="detail-card-header">
            <span className="detail-card-title">任务描述</span>
          </div>
          <div className="detail-card-body">
            <div className="task-desc-text">{taskData.description}</div>
          </div>
        </div>
      )}

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
                  disabled={isDone}
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
          {!isDone && (
            <button
              className="btn btn-accent btn-sm"
              disabled={submitting}
              onClick={handleSubmitCheckResult}
            >
              {submitting ? '提交中...' : '提交核对结果'}
            </button>
          )}
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
                disabled={isDone}
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
                disabled={isDone}
              />
            </div>
            <div className="manual-form-item">
              <label className="manual-form-label">包装状态</label>
              <select
                value={packageStatus}
                onChange={(e) => setPackageStatus(e.target.value)}
                className="manual-form-input"
                disabled={isDone}
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
                disabled={isDone}
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
                disabled={isDone}
              />
            </div>
            {submitResult && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
                background: submitResult.success ? 'var(--color-success-bg, #ecfdf5)' : 'var(--color-danger-bg, #fef2f2)',
                color: submitResult.success ? 'var(--color-success, #059669)' : 'var(--color-danger, #dc2626)' }}>
                {submitResult.message}
              </div>
            )}
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
