import { create } from 'zustand'
import type { A2uiMessageBase } from '../components/A2uiRenderer'

interface A2uiStore {
  title: string
  messages: A2uiMessageBase[]
  setSurface: (title: string, messages: A2uiMessageBase[]) => void
  clear: () => void
}

export const useA2uiStore = create<A2uiStore>((set) => ({
  title: '',
  messages: [],
  setSurface: (title, messages) => set({ title, messages }),
  clear: () => set({ title: '', messages: [] }),
}))
