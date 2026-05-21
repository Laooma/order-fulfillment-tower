import { create } from 'zustand'

export interface Tab {
  id: string
  title: string
  path: string
  closable: boolean
}

const HOME_TAB: Tab = {
  id: 'home',
  title: '首页',
  path: '/',
  closable: false,
}

const PATH_TO_TITLE: Record<string, string> = {
  '/': '首页',
  '/history': '历史分析',
  '/tasks': '任务列表',
  '/settings': '系统设置',
  '/a2ui': 'AI分析结果',
}

function deriveTitle(path: string): string {
  if (PATH_TO_TITLE[path]) return PATH_TO_TITLE[path]
  if (path.startsWith('/analysis/')) return '分析详情'
  if (path.startsWith('/task/agent/')) return 'Agent任务'
  if (path.startsWith('/task/decision/')) return '决策任务'
  if (path.startsWith('/task/manual/')) return '手工任务'
  return path
}

interface TabState {
  tabs: Tab[]
  activeTabId: string
  openTab: (path: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [HOME_TAB],
  activeTabId: 'home',

  openTab: (path: string) => {
    const state = get()
    const existing = state.tabs.find((t) => t.path === path)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const id = path.replace(/[^a-zA-Z0-9]/g, '-')
    const newTab: Tab = {
      id,
      title: deriveTitle(path),
      path,
      closable: true,
    }
    set({ tabs: [...state.tabs, newTab], activeTabId: id })
  },

  closeTab: (tabId: string) => {
    const state = get()
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!tab || !tab.closable) return

    const remaining = state.tabs.filter((t) => t.id !== tabId)
    if (remaining.length === 0) return

    if (state.activeTabId === tabId) {
      const idx = state.tabs.findIndex((t) => t.id === tabId)
      const nextIdx = Math.min(idx, remaining.length - 1)
      set({ tabs: remaining, activeTabId: remaining[nextIdx].id })
    } else {
      set({ tabs: remaining })
    }
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId })
  },
}))
