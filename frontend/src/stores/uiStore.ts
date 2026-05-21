import { create } from 'zustand'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || stored === 'light') return stored
  } catch {}
  return 'light'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

interface UIState {
  sidebarExpanded: boolean
  toggleSidebar: () => void
  theme: Theme
  toggleTheme: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarExpanded: false,
  toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
  theme: getInitialTheme(),
  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'light' ? 'dark' : 'light'
      try { localStorage.setItem('theme', next) } catch {}
      applyTheme(next)
      return { theme: next }
    }),
}))

// Apply theme immediately on module load (before React renders)
applyTheme(getInitialTheme())
