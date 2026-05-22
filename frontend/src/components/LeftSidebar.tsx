import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, History, ListChecks, PanelLeftClose, PanelLeftOpen, MessageSquarePlus } from 'lucide-react'
import { cn } from '../lib/utils'
import { useTabStore } from '../stores/tabStore'
import { api } from '../lib/api'

interface HistoryItem {
  id: string
  title: string
  analysisId: string
  time: string
}

const navItems = [
  { id: 'home', label: '首页', icon: Home, path: '/' },
  { id: 'analysis', label: '分析任务列表', icon: History, path: '/history' },
  { id: 'tasks', label: '执行任务列表', icon: ListChecks, path: '/tasks' },
]

export default function LeftSidebar() {
  const [expanded, setExpanded] = useState(false)
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const navigate = useNavigate()
  const location = useLocation()
  const openTab = useTabStore((s) => s.openTab)

  useEffect(() => {
    api.chat.sessions()
      .then((res) => {
        if (res?.data) {
          setHistoryItems(res.data.slice(0, 20).map((s) => ({
            id: s.id,
            title: s.title || '对话',
            analysisId: s.id,
            time: s.updated_at ? new Date(s.updated_at).toLocaleDateString('zh-CN') : '',
          })))
        }
      })
      .catch(() => {
        // fallback empty
      })
  }, [])

  const handleNavClick = (path: string) => {
    openTab(path)
    navigate(path)
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const handleNewConversation = () => {
    navigate('/')
  }

  return (
    <aside className={cn('shell-sidebar', expanded && 'expanded')}>
      {/* Nav items */}
      <div className="shell-sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={cn('shell-sidebar-nav-item', isActive(item.path) && 'active')}
              onClick={() => handleNavClick(item.path)}
              title={item.label}
            >
              <Icon size={18} />
              {expanded && <span className="shell-sidebar-nav-label">{item.label}</span>}
            </button>
          )
        })}
      </div>

      {/* New conversation button */}
      <button
        className="shell-sidebar-new-btn"
        onClick={handleNewConversation}
        title="新建对话"
      >
        <MessageSquarePlus size={16} />
        {expanded && <span className="shell-sidebar-new-label">新建对话</span>}
      </button>

      {/* Recent conversations */}
      <div className="shell-sidebar-history">
        {expanded && (
          <div className="shell-sidebar-history-header">最近对话</div>
        )}
        {historyItems.map((item) => (
          <button
            key={item.id}
            className={cn(
              'shell-sidebar-history-item',
              !expanded && 'collapsed'
            )}
            title={item.title}
            onClick={() => navigate(`/?session=${item.analysisId}`)}
          >
            <span className="shell-sidebar-history-icon">
              {item.title.charAt(0)}
            </span>
            {expanded && (
              <span className="shell-sidebar-history-text">
                <span className="shell-sidebar-history-title">{item.title.slice(0, 10)}{item.title.length > 10 ? '...' : ''}</span>
                <span className="shell-sidebar-history-time">{item.time}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toggle */}
      <button
        className="shell-sidebar-toggle"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? '收起侧栏' : '展开侧栏'}
      >
        {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
    </aside>
  )
}
