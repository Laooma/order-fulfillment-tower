import { create } from 'zustand'
import type { AnalysisTask, ChatMessage, SalesOrder } from '../types'

interface SessionState {
  currentSessionId: string | null
  selectedOrders: SalesOrder[]
  messages: ChatMessage[]
  isAnalyzing: boolean
  historyTasks: AnalysisTask[]
  setCurrentSessionId: (id: string | null) => void
  addSelectedOrder: (order: SalesOrder) => void
  removeSelectedOrder: (orderId: string) => void
  addMessage: (msg: ChatMessage) => void
  setAnalyzing: (v: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  currentSessionId: null,
  selectedOrders: [],
  messages: [],
  isAnalyzing: false,
  historyTasks: [],
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  addSelectedOrder: (order) =>
    set((state) => ({ selectedOrders: [...state.selectedOrders, order] })),
  removeSelectedOrder: (orderId) =>
    set((state) => ({ selectedOrders: state.selectedOrders.filter((o) => o.id !== orderId) })),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setAnalyzing: (v) => set({ isAnalyzing: v }),
}))
