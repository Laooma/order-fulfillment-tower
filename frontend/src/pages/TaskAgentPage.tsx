import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import TaskDetailLayout from '../components/TaskDetailLayout'
import { api } from '../lib/api'
import { getAnalysisTaskId } from '../lib/utils'

const agentLogs = [
  {
    num: 1,
    title: '获取合同与发货数据',
    time: '10:22:14 · 耗时 0.8s',
    output: '合同 SCJD20241114-K01 已加载\n发货单：SF20241202001（主仓库 → 安徽中转仓）\n当前状态：运输中 · 已耗时 5 天',
    status: 'completed' as const,
  },
  {
    num: 2,
    title: '调用物流接口查询实时轨迹',
    time: '10:22:35 · 耗时 1.2s',
    output: '顺丰接口返回：货物已于 12/04 到达「合肥蜀山中转场」\n下一站：安徽区域配送中心 · 预计 12/05 送达',
    status: 'completed' as const,
  },
  {
    num: 3,
    title: '比对系统入库记录',
    time: '10:23:08 · 耗时 0.5s',
    output: '系统入库记录：未找到 HT001241 对应入库单\n异常判定：物流已到达但仓库未扫码入库',
    status: 'completed' as const,
  },
  {
    num: 4,
    title: '生成处理建议与待办',
    time: '10:24:36 · 耗时 0.3s',
    output: '生成 3 项建议 · 1 项待办任务 · 已推送至「张伟」',
    status: 'completed' as const,
  },
]

export default function TaskAgentPage() {
  const { id } = useParams()
  const [taskData, setTaskData] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    api.tasks.get(id)
      .then((data) => setTaskData(data))
      .catch(() => { /* use defaults */ })
  }, [id])

  return (
    <TaskDetailLayout
      title={taskData ? `${taskData.typeLabel} — ${taskData.title}` : 'Agent 任务 — 未接发货问题处理'}
      taskId={id}
      contractId={taskData?.contractId}
      task={taskData}
    >
      {/* Agent Status Card */}
      <div className="agent-status-card">
        <div className="agent-status-icon">A</div>
        <div className="agent-status-body">
          <div className="agent-status-title">产品型销售订单确认收入智能体</div>
          <div className="agent-status-sub">已执行 4 个步骤 · 耗时 2 分 18 秒 · 最后更新 10:24:36</div>
        </div>
        <span className="agent-status-badge">执行完成</span>
      </div>

      {/* Execution Log */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">执行日志</span>
          <span className="text-[11px] text-muted font-mono">4 / 4 步骤</span>
        </div>
        <div className="detail-card-body">
          {agentLogs.map((log) => (
            <div key={log.num} className={`agent-log-step ${log.status}`}>
              <div className="agent-log-num">{log.num}</div>
              <div className="agent-log-body">
                <div className="agent-log-title">{log.title}</div>
                <div className="agent-log-time">{log.time}</div>
                <div className="agent-log-output">{log.output}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Suggestion */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">AI 处理建议</span>
        </div>
        <div className="detail-card-body">
          <div className="agent-suggestion-box">
            <div className="agent-suggestion-title">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="var(--color-accent)">
                <path d="M7 1l1.8 4.2H13l-3.5 2.6L10.8 12 7 9.4 3.2 12l1.3-4.2L1 5.2h4.2z" />
              </svg>
              智能分析结论
            </div>
            <div className="agent-suggestion-body">
              <p className="mb-2">该异常为「物流已到达中转仓，但仓库尚未完成扫码入库」类型。根据历史数据，此类异常平均处理时长为 <strong>1.2 个工作日</strong>，95% 可在当天内解决。</p>
              <p><strong>根因推测：</strong></p>
              <ol className="mt-1.5 ml-[18px] text-muted leading-7">
                <li>中转仓当日入库量较大，扫描排队延迟</li>
                <li>货物批次标签磨损，需人工复核后再入库</li>
                <li>物流方「到达」状态推送早于实际卸货完成时间</li>
              </ol>
            </div>
            <div className="agent-action-bar">
              <button className="btn btn-primary">采纳建议并执行</button>
              <button className="btn btn-outline">重新执行 Agent</button>
              <button className="btn btn-ghost">查看原始数据</button>
            </div>
          </div>
        </div>
      </div>

      {/* Issue Info */}
      <div className="detail-card">
        <div className="detail-card-header">
          <span className="detail-card-title">问题信息</span>
        </div>
        <div className="detail-card-body">
          <div className="info-grid">
            <div>
              <div className="info-item-label">问题类型</div>
              <div className="info-item-value">未接发货</div>
            </div>
            <div>
              <div className="info-item-label">问题分类</div>
              <div className="info-item-value">问题类型 1</div>
            </div>
            <div>
              <div className="info-item-label">发现时间</div>
              <div className="info-item-value">2025/03/13</div>
            </div>
            <div>
              <div className="info-item-label">当前状态</div>
              <div className="info-item-value"><span className="text-danger">待处理</span></div>
            </div>
          </div>
        </div>
      </div>
    </TaskDetailLayout>
  )
}
