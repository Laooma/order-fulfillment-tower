import { create } from 'zustand'

export interface ChatPageConfig {
  sessionId?: string
  page: string
  taskId?: string
  visible?: boolean
  orders?: string[]
  cabinetPackages?: string[]
  tabs?: { key: string; label: string; hidden?: boolean }[]
  activeTab?: string
  lockAgent?: boolean
  defaultSkillId?: string
  defaultSkillName?: string
  onTabChange?: (tab: string) => void
  onAnalysisNavigate?: (path: string) => void
  onAnalysisComplete?: (analysisId: string) => void
  onA2uiSurface?: (data: { title: string; messages: unknown[] }) => void
  onClearOrders?: () => void
  onClearCabinets?: () => void
}

interface ChatStore {
  isRunning: boolean
  setIsRunning: (v: boolean) => void

  pageConfig: ChatPageConfig | null
  setPageConfig: (config: ChatPageConfig | null) => void

  footerSlot: React.ReactNode
  setFooterSlot: (node: React.ReactNode) => void
  detailSlot: React.ReactNode
  setDetailSlot: (node: React.ReactNode) => void

  sendMessage: ((message: string, opts?: { taskId?: string; orders?: string[]; cabinetPackages?: string[] }) => void) | null
  setSendMessage: (fn: ((message: string, opts?: { taskId?: string; orders?: string[]; cabinetPackages?: string[] }) => void) | null) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  isRunning: false,
  setIsRunning: (isRunning) => set({ isRunning }),

  pageConfig: null,
  setPageConfig: (pageConfig) => set({ pageConfig }),

  footerSlot: null,
  setFooterSlot: (footerSlot) => set({ footerSlot }),
  detailSlot: null,
  setDetailSlot: (detailSlot) => set({ detailSlot }),

  sendMessage: null,
  setSendMessage: (sendMessage) => set({ sendMessage }),
}))
