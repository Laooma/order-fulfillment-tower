import { useState, useEffect, useRef } from 'react'
import { cn } from '../lib/utils'
import type { TodoItem } from '../hooks/useWebSocket'

interface TodoWidgetProps {
  todos: TodoItem[]
  taskOutputs: Record<string, string>
}

const statusIcon = (status: TodoItem['status']) => {
  switch (status) {
    case 'completed':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5.5" fill="#22c55e" stroke="#22c55e" strokeWidth="1" />
          <path d="M3.5 6l2 2 3-4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'in_progress':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="todo-spinner">
          <circle cx="6" cy="6" r="5" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="8 24" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="oklch(65% 0.02 240)" strokeWidth="1" />
        </svg>
      )
  }
}

export default function TodoWidget({ todos, taskOutputs }: TodoWidgetProps) {
  if (!todos || todos.length === 0) return null

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState(false)
  const manualToggles = useRef<Set<string>>(new Set())

  // Auto-expand in_progress, respect manual toggles for completed
  useEffect(() => {
    setExpandedTasks(() => {
      const next = new Set<string>()
      for (const t of todos) {
        if (t.status === 'in_progress') {
          next.add(t.id)
        } else if (manualToggles.current.has(t.id)) {
          next.add(t.id)
        }
      }
      return next
    })
  }, [todos])

  const toggleTask = (id: string) => {
    if (manualToggles.current.has(id)) {
      manualToggles.current.delete(id)
    } else {
      manualToggles.current.add(id)
    }
    setExpandedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const hasTodos = todos.length > 0

  return (
    <div className="todo-widget">
      <div className="todo-widget-header">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        </svg>
        <span className="todo-widget-title">任务列表</span>
        {hasTodos && (
          <span className="todo-widget-count">
            {completedCount}/{todos.length}
          </span>
        )}
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
            const isExpanded = expandedTasks.has(todo.id)
            const hasOutput = taskOutputs[todo.id] && taskOutputs[todo.id].length > 0
            const isClickable = todo.status === 'completed' && hasOutput

            return (
              <div key={todo.id}>
                <div
                  className={cn(
                    'todo-widget-item',
                    todo.status === 'completed' && 'done',
                    todo.status === 'in_progress' && 'active',
                    isClickable && 'clickable',
                  )}
                  onClick={() => isClickable ? toggleTask(todo.id) : undefined}
                >
                  <span className="todo-widget-status">{statusIcon(todo.status)}</span>
                  <span className="todo-widget-content">{todo.content}</span>
                  {todo.status === 'in_progress' && <span className="todo-widget-tag">处理中</span>}
                  {isClickable && (
                    <span className="todo-widget-chevron">{isExpanded ? '▾' : '▸'}</span>
                  )}
                </div>
                {isExpanded && hasOutput && (
                  <div className="todo-widget-output">
                    {taskOutputs[todo.id]}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
