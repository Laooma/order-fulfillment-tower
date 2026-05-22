import { useState } from 'react'
import { cn } from '../lib/utils'
import type { TodoItem } from '../hooks/useWebSocket'

interface TodoWidgetProps {
  todos: TodoItem[]
}

const statusIcon = (status: TodoItem['status']) => {
  switch (status) {
    case 'completed':
      return (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5.5" fill="#22c55e" stroke="#22c55e" strokeWidth="1" />
          <path d="M3.5 6l2 2 3-4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'in_progress':
      return (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="todo-spinner">
          <circle cx="6" cy="6" r="5" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="8 24" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="oklch(65% 0.02 240)" strokeWidth="1" />
        </svg>
      )
  }
}

const verifiedIcon = (verified?: boolean) => {
  if (verified === undefined) return null
  if (verified) {
    return (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
        <title>已验证</title>
        <circle cx="5" cy="5" r="4.5" fill="#22c55e20" stroke="#22c55e" strokeWidth="1" />
        <path d="M2.5 5l2 1.5 3-3" stroke="#22c55e" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
        <title>验证未通过</title>
      <circle cx="5" cy="5" r="4.5" fill="#f59e0b20" stroke="#f59e0b" strokeWidth="1" />
      <path d="M5 2.5v3M5 7v.5" stroke="#f59e0b" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export default function TodoWidget({ todos }: TodoWidgetProps) {
  if (!todos || todos.length === 0) return null

  const [collapsed, setCollapsed] = useState(false)
  const completedCount = todos.filter((t) => t.status === 'completed').length

  // Check if a task's dependencies are met
  const depsMet = (todo: TodoItem): boolean => {
    if (!todo.blockedBy || todo.blockedBy.length === 0) return true
    return todo.blockedBy.every(did => {
      const dep = todos.find(t => t.id === did)
      return dep && dep.status === 'completed'
    })
  }

  return (
    <div className="todo-widget">
      <div className="todo-widget-header">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        </svg>
        <span className="todo-widget-title">任务列表</span>
        <span className="todo-widget-count">
          {completedCount}/{todos.length}
        </span>
        <button
          className="todo-widget-collapse-btn"
          onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }}
          title={collapsed ? '展开任务列表' : '收起任务列表'}
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          >
            <path d="M2 3l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      </div>
      {!collapsed && (
        <div className="todo-widget-list">
          {todos.map((todo) => {
            const blocked = !depsMet(todo)
            return (
              <div
                key={todo.id}
                className={cn(
                  'todo-widget-item',
                  todo.status === 'completed' && 'done',
                  todo.status === 'in_progress' && 'active',
                  blocked && 'blocked',
                )}
              >
                <span className="todo-widget-status">
                  {blocked ? (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <title>等待依赖任务完成</title>
                      <rect x="2" y="5" width="8" height="5.5" rx="1" stroke="oklch(65% 0.01 30)" strokeWidth="1" />
                      <path d="M6 2v5" stroke="oklch(65% 0.01 30)" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="6" cy="8" r="0.8" fill="oklch(65% 0.01 30)" />
                    </svg>
                  ) : (
                    statusIcon(todo.status)
                  )}
                </span>
                <span className="todo-widget-content">{todo.content}</span>
                {todo.status === 'in_progress' && !blocked && <span className="todo-widget-tag">处理中</span>}
                {todo.status === 'completed' && todo.verified !== undefined && (
                  <span className="todo-widget-verified">{verifiedIcon(todo.verified)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
