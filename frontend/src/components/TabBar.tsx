import { useNavigate, useLocation } from 'react-router-dom'
import { X, Plus } from 'lucide-react'
import { useTabStore } from '../stores/tabStore'
import { cn } from '../lib/utils'

export default function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tabs, activeTabId, openTab, closeTab } = useTabStore()

  const handleTabClick = (tab: (typeof tabs)[0]) => {
    navigate(tab.path)
  }

  const handleTabClose = (e: React.MouseEvent, tab: (typeof tabs)[0]) => {
    e.stopPropagation()
    const isActive = tab.id === activeTabId
    closeTab(tab.id)
    if (isActive) {
      const { tabs: updatedTabs, activeTabId: newActiveId } = useTabStore.getState()
      const newActiveTab = updatedTabs.find(t => t.id === newActiveId)
      if (newActiveTab) {
        navigate(newActiveTab.path)
      }
    }
  }

  const handleNewTab = () => {
    navigate('/')
  }

  return (
    <div className="shell-tabbar">
      <div className="shell-tabbar-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn('shell-tab', tab.path === location.pathname && 'active')}
            onClick={() => handleTabClick(tab)}
          >
            <span className="shell-tab-title">{tab.title}</span>
            {tab.closable && (
              <button
                className="shell-tab-close"
                onClick={(e) => handleTabClose(e, tab)}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="shell-tab-new" onClick={handleNewTab} title="新建页面">
        <Plus size={14} />
      </button>
    </div>
  )
}
