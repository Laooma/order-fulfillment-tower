import type { Request, Response, NextFunction } from 'express'
import { getDb } from '../services/database'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const TOKEN_EXPIRY = '24h'

export interface DataScopeRule {
  field: string
  op: string
  value: string
}

export interface StructuredScope {
  rules: DataScopeRule[]
  logic: 'AND' | 'OR'
}

export type ScopeValue = string | StructuredScope

export interface CurrentUser {
  id: string
  username: string
  displayName: string
  orgId: string
  roles: string[]
  permissions: {
    menus: Set<string>
    operations: Set<string>
    dataScopes: Record<string, ScopeValue[]>
    skills: Set<string>
  }
}

// Field metadata for visual rule builder — also used for SQL generation
export const scopeFieldMeta: Record<string, Array<{ field: string; label: string; type: string; options?: string[] }>> = {
  orders: [
    { field: 'region', label: '区域', type: 'string' },
    { field: 'sales', label: '销售', type: 'string' },
    { field: 'customer', label: '客户', type: 'string' },
    { field: 'status', label: '状态', type: 'string', options: ['待发货', '部分出库', '已出库', '已完成'] },
    { field: 'amount', label: '金额', type: 'number' },
    { field: 'order_date', label: '订单日期', type: 'date' },
  ],
  analysis_tasks: [
    { field: 'title', label: '标题', type: 'string' },
    { field: 'agent', label: '智能体', type: 'string' },
    { field: 'initiator', label: '发起人', type: 'string' },
    { field: 'status', label: '状态', type: 'string', options: ['analyzing', 'completed'] },
    { field: 'created_at', label: '创建时间', type: 'date' },
  ],
  todos: [
    { field: 'category', label: '分类', type: 'string' },
    { field: 'priority', label: '优先级', type: 'string', options: ['high', 'medium', 'low'] },
    { field: 'assignee', label: '负责人', type: 'string' },
    { field: 'status', label: '状态', type: 'string', options: ['pending', 'progress', 'overdue', 'done'] },
    { field: 'due_date', label: '截止日期', type: 'date' },
    { field: 'task_type', label: '任务类型', type: 'string', options: ['agent', 'decision', 'manual'] },
  ],
}

// Map resource key to actual DB table/column aliases used in queries
const scopeTableMap: Record<string, Record<string, string>> = {
  orders: { region: 'ao.region', sales: 'ao.sales', customer: 'ao.customer', status: 'ao.status', amount: 'ao.amount', order_date: 'ao.order_date' },
  analysis_tasks: { title: 'at.title', agent: 'at.agent', initiator: 'at.initiator', status: 'at.status', created_at: 'at.created_at' },
  todos: { category: 'at2.category', priority: 'at2.priority', assignee: 'at2.assignee', status: 'at2.status', due_date: 'at2.due_date', task_type: 'at2.task_type' },
}

// Generate JWT token for a user
export function generateToken(user: { id: string; username: string; displayName: string }): string {
  return jwt.sign(
    { userId: user.id, username: user.username, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  )
}

// Auth middleware: JWT from Authorization header, fallback to X-User-Id
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  let userId: string | null = null

  // 1. Try Authorization: Bearer <token>
  const authHeader = req.headers['authorization']
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7)
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string }
      userId = payload.userId
    } catch {
      // Token invalid/expired — continue to fallback
    }
  }

  // 2. Fallback to X-User-Id header for dev convenience
  if (!userId) {
    userId = (req.headers['x-user-id'] as string) || 'user_admin'
  }

  ;(req as any).currentUser = loadCurrentUser(userId)
  next()
}

export function loadCurrentUser(userId: string): CurrentUser {
  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any

  if (!user) {
    return {
      id: '',
      username: 'anonymous',
      displayName: '匿名用户',
      orgId: '',
      roles: [],
      permissions: { menus: new Set(), operations: new Set(), dataScopes: {}, skills: new Set() },
    }
  }

  // Load roles
  const roleRows = db.prepare(
    'SELECT role_id FROM user_roles WHERE user_id = ?'
  ).all(userId) as any[]
  const roleIds = roleRows.map((r: any) => r.role_id)

  if (roleIds.length === 0) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      orgId: user.org_id || '',
      roles: [],
      permissions: { menus: new Set(), operations: new Set(), dataScopes: {}, skills: new Set() },
    }
  }

  // Load permissions from all roles
  const placeholders = roleIds.map(() => '?').join(',')
  const perms = db.prepare(
    `SELECT * FROM role_permissions WHERE role_id IN (${placeholders})`
  ).all(...roleIds) as any[]

  const menus = new Set<string>()
  const operations = new Set<string>()
  const skills = new Set<string>()
  const dataScopes: Record<string, ScopeValue[]> = {}

  for (const p of perms) {
    if (p.permission_type === 'menu') menus.add(p.resource_id)
    else if (p.permission_type === 'operation') operations.add(p.resource_id)
    else if (p.permission_type === 'skill') skills.add(p.resource_id)
    else if (p.permission_type === 'data' && p.extra) {
      try {
        const scope = JSON.parse(p.extra)
        for (const [resource, value] of Object.entries(scope)) {
          if (!value) continue
          if (!dataScopes[resource]) dataScopes[resource] = []
          if (typeof value === 'string' && value.trim()) {
            dataScopes[resource].push(value)
          } else if (typeof value === 'object' && (value as any).rules && Array.isArray((value as any).rules)) {
            dataScopes[resource].push(value as StructuredScope)
          }
        }
      } catch { /* ignore malformed JSON */ }
    }
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    orgId: user.org_id || '',
    roles: roleIds,
    permissions: { menus, operations, dataScopes, skills },
  }
}

// Check if current user has the required operation permission
export function requireOperation(code: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).currentUser as CurrentUser | undefined
    if (!user || !user.permissions.operations.has(code)) {
      res.status(403).json({ error: `Forbidden: missing operation '${code}'` })
      return
    }
    next()
  }
}

// Build SQL WHERE fragment from data scopes for a given resource
export function applyDataScope(user: CurrentUser, resource: string): { sql: string; params: any[] } {
  const scopes = user.permissions.dataScopes[resource]
  if (!scopes || scopes.length === 0) return { sql: '', params: [] }

  const tableMap = scopeTableMap[resource] || {}

  const clauses = scopes.map(scope => {
    if (typeof scope === 'string') {
      return scope.replace(/:currentUser/g, `'${user.username}'`)
    }

    const { rules, logic } = scope
    if (!rules || rules.length === 0) return ''

    const ruleClauses = rules.map(r => {
      const col = tableMap[r.field] || r.field
      const val = r.value.replace(/:currentUser/g, user.username)

      switch (r.op) {
        case '=':
          return `${col} = '${escapeSql(val)}'`
        case '!=':
          return `${col} != '${escapeSql(val)}'`
        case '>':
          return `${col} > '${escapeSql(val)}'`
        case '<':
          return `${col} < '${escapeSql(val)}'`
        case '>=':
          return `${col} >= '${escapeSql(val)}'`
        case '<=':
          return `${col} <= '${escapeSql(val)}'`
        case 'LIKE':
          return `${col} LIKE '%${escapeSql(val)}%'`
        case 'IN':
          return `${col} IN (${val.split(',').map(v => `'${escapeSql(v.trim())}'`).join(', ')})`
        case 'NOT IN':
          return `${col} NOT IN (${val.split(',').map(v => `'${escapeSql(v.trim())}'`).join(', ')})`
        default:
          return `${col} = '${escapeSql(val)}'`
      }
    }).filter(Boolean)

    if (ruleClauses.length === 0) return ''
    const joiner = logic === 'OR' ? ' OR ' : ' AND '
    return `(${ruleClauses.join(joiner)})`
  }).filter(Boolean)

  const validClauses = clauses.filter(c => c !== '')

  if (validClauses.length === 0) return { sql: '', params: [] }
  if (validClauses.length === 1) {
    return { sql: ` AND (${validClauses[0]})`, params: [] }
  }
  return { sql: ` AND (${validClauses.join(' OR ')})`, params: [] }
}

function escapeSql(val: string): string {
  return val.replace(/'/g, "''")
}
