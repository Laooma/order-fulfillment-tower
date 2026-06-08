import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'

interface UsageSummary {
  today: { prompt: number; completion: number; total: number; requests: number; sessions: number }
  week: { prompt: number; completion: number; total: number; requests: number }
  allTime: { prompt: number; completion: number; total: number; requests: number; sessions: number; cachedPrompt: number; uncachedPrompt: number }
}

interface UsageDailyItem {
  date: string; prompt: number; completion: number; total: number; requests: number
}

interface UsageModelItem {
  model: string; prompt: number; completion: number; total: number; requests: number
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export default function UsagePanel({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [daily, setDaily] = useState<UsageDailyItem[]>([])
  const [models, setModels] = useState<UsageModelItem[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    const baseUrl = import.meta.env.VITE_AGENT_BASE_URL || 'http://localhost:3002'
    const userId = user?.id ? `?userId=${encodeURIComponent(user.id)}` : ''
    try {
      const [summaryRes, dailyRes, modelsRes] = await Promise.all([
        fetch(`${baseUrl}/usage/summary${userId}`),
        fetch(`${baseUrl}/usage/daily?days=14${userId ? `&userId=${encodeURIComponent(user.id!)}` : ''}`),
        fetch(`${baseUrl}/usage/models${userId}`),
      ])
      setSummary(await summaryRes.json())
      setDaily(await dailyRes.json())
      setModels(await modelsRes.json())
    } catch { /* ignore */ }
    setLoading(false)
  }

  // Lazy-load on mount
  if (!summary && !loading) {
    fetchData()
    return null
  }

  const cachedTotal = summary?.allTime.cachedPrompt || 0
  const uncachedTotal = summary?.allTime.uncachedPrompt || 0
  const cacheHitRate = summary?.allTime.prompt ? Math.round((cachedTotal / summary.allTime.prompt) * 100) : 0

  return (
    <div className="usage-overlay" onClick={onClose}>
      <div className="usage-panel" onClick={(e) => e.stopPropagation()}>
        <div className="usage-panel-header">
          <span>📊 Token 消耗统计</span>
          {user && <span className="usage-panel-user">@{user.username}</span>}
          <button className="usage-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="usage-panel-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--color-muted)' }}>加载中...</div>
          ) : (
            <>
              <div className="usage-grid">
                <div className="usage-card">
                  <div className="usage-card-label">今日</div>
                  <div className="usage-card-value">{formatTokens(summary?.today.total || 0)}</div>
                  <div className="usage-card-detail">
                    {summary?.today.requests || 0} 请求 · {summary?.today.sessions || 0} 会话
                  </div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">本周</div>
                  <div className="usage-card-value">{formatTokens(summary?.week.total || 0)}</div>
                  <div className="usage-card-detail">{summary?.week.requests || 0} 请求</div>
                </div>
                <div className="usage-card">
                  <div className="usage-card-label">全部</div>
                  <div className="usage-card-value">{formatTokens(summary?.allTime.total || 0)}</div>
                  <div className="usage-card-detail">
                    {summary?.allTime.requests || 0} 请求 · {summary?.allTime.sessions || 0} 会话
                  </div>
                </div>
              </div>
              <div className="usage-breakdown">
                <div className="usage-breakdown-row">
                  <span className="usage-breakdown-label">输入 tokens</span>
                  <span className="usage-breakdown-val in">{formatTokens(summary?.allTime.prompt || 0)}</span>
                </div>
                <div className="usage-breakdown-row">
                  <span className="usage-breakdown-label">输出 tokens</span>
                  <span className="usage-breakdown-val out">{formatTokens(summary?.allTime.completion || 0)}</span>
                </div>
                <div className="usage-breakdown-row total">
                  <span className="usage-breakdown-label">总计</span>
                  <span className="usage-breakdown-val">{formatTokens(summary?.allTime.total || 0)}</span>
                </div>
              </div>
              {/* Cache hit rate */}
              {(cachedTotal > 0 || uncachedTotal > 0) && (
                <div className="usage-breakdown" style={{ marginTop: 4 }}>
                  <div className="usage-section-title" style={{ marginTop: 0 }}>缓存命中</div>
                  <div className="usage-breakdown-row">
                    <span className="usage-breakdown-label">命中缓存</span>
                    <span className="usage-breakdown-val in">{formatTokens(cachedTotal)}</span>
                  </div>
                  <div className="usage-breakdown-row">
                    <span className="usage-breakdown-label">未命中缓存</span>
                    <span className="usage-breakdown-val out">{formatTokens(uncachedTotal)}</span>
                  </div>
                  <div className="usage-breakdown-row">
                    <span className="usage-breakdown-label">命中率</span>
                    <span className="usage-breakdown-val" style={{ color: cacheHitRate > 50 ? '#22c55e' : 'var(--color-muted)' }}>{cacheHitRate}%</span>
                  </div>
                </div>
              )}
              {models.length > 0 && (
                <div className="usage-models">
                  <div className="usage-section-title">模型用量</div>
                  {models.map((m) => (
                    <div key={m.model} className="usage-model-row">
                      <span className="usage-model-name">{m.model || '(unknown)'}</span>
                      <span className="usage-model-stats">
                        <span className="usage-model-total">{formatTokens(m.total)}</span>
                        <span className="usage-model-requests">{m.requests} 次</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {daily.length > 0 && (
                <div className="usage-daily">
                  <div className="usage-section-title">每日消耗</div>
                  <div className="usage-daily-chart">
                    {daily.slice(0, 14).reverse().map((d) => {
                      const maxTotal = Math.max(...daily.map(x => x.total), 1)
                      const barWidth = Math.max(2, Math.round((d.total / maxTotal) * 100))
                      return (
                        <div key={d.date} className="usage-daily-bar-wrap" title={`${d.date}: ${formatTokens(d.total)} (${d.requests} 请求)`}>
                          <div className="usage-daily-date">{d.date.slice(5)}</div>
                          <div className="usage-daily-bar-track">
                            <div className="usage-daily-bar" style={{ width: `${barWidth}%` }} />
                          </div>
                          <div className="usage-daily-val">{formatTokens(d.total)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
