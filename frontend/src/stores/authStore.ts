import { create } from 'zustand'
import { api } from '../lib/api'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  orgId: string
  adoptedPetId: string
  roles: string[]
  permissions: {
    menus: string[]
    operations: string[]
    dataScopes: Record<string, any>
    skills: string[]
  }
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
  hasMenu: (menuId: string) => boolean
  hasOperation: (code: string) => boolean
  hasSkill: (skillId: string) => boolean
  isAdmin: () => boolean
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem('auth_token')
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getStoredToken(),
  user: null,
  isAuthenticated: false,
  isLoading: !!getStoredToken(),

  login: async (username: string, password: string) => {
    const { token, user } = await api.auth.login(username, password)
    localStorage.setItem('auth_token', token)
    set({
      token,
      user,
      isAuthenticated: true,
      isLoading: false,
    })
  },

  logout: () => {
    localStorage.removeItem('auth_token')
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
    })
    api.auth.logout().catch(() => {})
  },

  loadUser: async () => {
    const token = get().token
    if (!token) {
      set({ isLoading: false })
      return
    }
    try {
      const user = await api.auth.me()
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      localStorage.removeItem('auth_token')
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },

  hasMenu: (menuId: string) => {
    const user = get().user
    if (!user) return false
    return user.permissions.menus.includes(menuId)
  },

  hasOperation: (code: string) => {
    const user = get().user
    if (!user) return false
    return user.permissions.operations.includes(code)
  },

  hasSkill: (skillId: string) => {
    const user = get().user
    if (!user) return false
    // Admin can use all skills
    if (user.roles.includes('role_admin')) return true
    // Users with use_skills operation can use all skills (no per-skill restriction)
    if (user.permissions.operations.includes('use_skills')) return true
    // Fallback: explicit per-skill permission check
    return user.permissions.skills.includes(skillId)
  },

  isAdmin: () => {
    const user = get().user
    if (!user) return false
    return user.roles.includes('role_admin')
  },
}))
