import { useEffect, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import TopBar from './TopBar'
import LeftSidebar from './LeftSidebar'
import TabBar from './TabBar'
import ChatPanel from './ChatPanel'
import { useTabStore } from '../stores/tabStore'

export default function ShellLayout() {
  const location = useLocation()
  const openTab = useTabStore((s) => s.openTab)

  // Sync URL changes to tab system
  useEffect(() => {
    if (location.pathname !== '/login') {
      openTab(location.pathname)
    }
  }, [location.pathname])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <div className="flex flex-col flex-1 overflow-hidden shell-content">
          <TabBar />
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <div className="shell-chat-area">
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
