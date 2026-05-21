import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import TaskDetailLayout from '../components/TaskDetailLayout'
import { api } from '../lib/api'

const options = [
  {
    id: 'A',
    label: '方案 A：联系中转仓加急入库',
    desc: '直接致电合肥中转仓负责人，要求当日完成入库扫描',
    time: '0.5 工作日',
    risk: '低',
    riskClass: 'badge-pill success',
    cost: '无额外成本',
  },
  {
    id: 'B',
    label: '方案 B：申请部分发货确认',
    desc: '向客户申请先确认已到达部分，剩余待入库完成后再补录',
    time: '1 工作日',
    risk: '中',
    riskClass: 'badge-pill warning',
    cost: '可能影响客户满意度',
  },
  {
    id: 'C',
    label: '方案 C：启动备用供应商补货',
    desc: '从备用供应商紧急调拨同型号产品，确保客户不中断',
    time: '2–3 工作日',
    risk: '高',
    riskClass: 'badge-pill danger',
    cost: '额外成本约 8.5 万元',
  },
]

export default function TaskDecisionPage() {
  const { id } = useParams()
  const [selected, setSelected] = useState('A')
  const [comment, setComment] = useState('')
  const [taskData, setTaskData] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    api.tasks.get(id)
      .then((data) => setTaskData(data))
      .catch(() => { /* use defaults */ })
  }, [id])

  return (
    <TaskDetailLayout
      title={taskData ? `${taskData.typeLabel} — ${taskData.title}` : '决策任务 — 确认中转仓入库异常的处理方案'}
      taskId={id}
      contractId={taskData?.contractId}
      task={taskData}
    >
      {/* Decision Status Card */}
      <div className="decision-status-card">
        <div className="decision-status-icon">决</div>
        <div className="agent-status-body">
          <div className="agent-status-title">决策事项：确认中转仓入库异常的处理方案</div>
          <div className="agent-status-sub">决策人：张伟 · 需在 2024/11/16 前完成 · 已超期 1 天</div>
        </div>
        <span className="decision-status-badge">待决策</span>
      </div>

      {/* Decision Options */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">决策选项</span>
        </div>
        <div className="detail-card-body" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="decision-option-table">
            <thead>
              <tr>
                <th style={{ width: '50px', paddingLeft: '16px' }}>选择</th>
                <th>方案</th>
                <th style={{ width: '120px' }}>预计耗时</th>
                <th style={{ width: '100px' }}>风险等级</th>
                <th style={{ width: '160px', paddingRight: '16px' }}>成本影响</th>
              </tr>
            </thead>
            <tbody>
              {options.map((opt) => (
                <tr
                  key={opt.id}
                  className={selected === opt.id ? 'option-selected' : ''}
                >
                  <td style={{ paddingLeft: '16px' }}>
                    <input
                      type="radio"
                      name="decision"
                      checked={selected === opt.id}
                      onChange={() => setSelected(opt.id)}
                      className="decision-radio"
                    />
                  </td>
                  <td>
                    <div className="decision-option-label">{opt.label}</div>
                    <div className="decision-option-desc">{opt.desc}</div>
                  </td>
                  <td>{opt.time}</td>
                  <td>
                    <span className={opt.riskClass}>
                      {opt.risk}
                    </span>
                  </td>
                  <td style={{ paddingRight: '16px' }}>{opt.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Basis */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">决策依据</span>
        </div>
        <div className="detail-card-body">
          <div className="text-xs text-fg leading-relaxed">
            <p className="mb-2.5"><strong>相关数据参考：</strong></p>
            <div className="info-grid mb-3.5">
              <div>
                <div className="info-item-label">中转仓历史平均入库时效</div>
                <div className="info-item-value mono">6.2 小时</div>
              </div>
              <div>
                <div className="info-item-label">同类型异常 7 日内处理率</div>
                <div className="info-item-value mono">94.3%</div>
              </div>
              <div>
                <div className="info-item-label">客户合同交货期剩余</div>
                <div className="info-item-value mono">12 天</div>
              </div>
            </div>
            <p className="text-muted">合肥蜀山中转场今日入库量较平日增加 34%，队列延迟属预期范围内。建议优先选择方案 A，如 24 小时内未解决再考虑方案 B。</p>
          </div>
        </div>
      </div>

      {/* Submit Decision */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">提交决策</span>
        </div>
        <div className="detail-card-body">
          <div className="decision-form">
            <label className="decision-form-label">决策意见（必填）</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="请输入决策意见，如：同意方案A，要求中转仓当日完成入库扫描"
              className="decision-form-textarea"
            />
            <div className="decision-action-bar">
              <button className="btn btn-success">通过并执行</button>
              <button className="btn btn-danger">驳回</button>
              <button className="btn btn-outline">转交上级决策</button>
            </div>
          </div>
        </div>
      </div>
    </TaskDetailLayout>
  )
}
