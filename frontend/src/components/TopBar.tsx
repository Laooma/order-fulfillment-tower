import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut, ChevronDown, Sun, Moon } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'

export default function TopBar() {
  const { user, isAuthenticated, logout } = useAuthStore()
  const { theme, toggleTheme } = useUIStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const roleName = user?.roles?.includes('role_admin') ? '管理员'
    : user?.roles?.length ? '用户'
    : ''

  return (
    <header className="shell-topbar">
      <div className="shell-topbar-logo">
        <div className="shell-topbar-logo-icon">
          <svg width="12" height="12" viewBox="0 0 14 14">
            <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z" opacity="0.9" fill="#fff" />
          </svg>
        </div>
        <span className="shell-topbar-logo-text">订单履约控制塔</span>
      </div>

      <div className="shell-topbar-right">
        <button
          className="shell-topbar-icon-btn"
          title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          className="shell-topbar-icon-btn"
          title="系统设置"
          onClick={() => navigate('/settings')}
        >
          <Settings size={15} />
        </button>

        {isAuthenticated ? (
          <div className="shell-topbar-user" ref={menuRef}>
            <button
              className="shell-topbar-user-btn"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <div className="shell-topbar-avatar">
                {user?.displayName ? user.displayName.slice(0, 2) : 'Hi'}
              </div>
              <span className="shell-topbar-username">{user?.displayName || '用户'}</span>
              {roleName && <span className="shell-topbar-tag">{roleName}</span>}
              <ChevronDown size={10} style={{ opacity: 0.4 }} />
            </button>
            {menuOpen && (
              <div className="shell-topbar-dropdown">
                <div className="shell-topbar-dropdown-info">
                  <span className="shell-topbar-dropdown-name">{user?.displayName}</span>
                  <span className="shell-topbar-dropdown-username">@{user?.username}</span>
                </div>
                <button className="shell-topbar-dropdown-item" onClick={() => { logout(); setMenuOpen(false); }}>
                  <LogOut size={13} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="shell-topbar-user">
            <div className="shell-topbar-avatar">?</div>
            <span className="shell-topbar-username">未登录</span>
          </div>
        )}
      </div>
    </header>
  )
}
