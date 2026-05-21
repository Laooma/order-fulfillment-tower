import { Router } from 'express'
import { getDb } from '../services/database'
import { scopeFieldMeta, requireOperation } from '../middleware/auth'
import crypto from 'crypto'

const router = Router()

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

// ── Operation definitions (hardcoded reference) ──

const operationGroups: Array<{ group: string; items: Array<{ code: string; name: string }> }> = [
  {
    group: '订单管理',
    items: [
      { code: 'view_orders', name: '查看订单' },
      { code: 'export_orders', name: '导出订单' },
      { code: 'edit_orders', name: '编辑订单' },
    ],
  },
  {
    group: '分析任务',
    items: [
      { code: 'view_analysis', name: '查看分析任务' },
      { code: 'create_analysis', name: '创建分析任务' },
      { code: 'delete_analysis', name: '删除分析任务' },
    ],
  },
  {
    group: '执行任务',
    items: [
      { code: 'view_todos', name: '查看执行任务' },
      { code: 'assign_todos', name: '分配执行任务' },
      { code: 'update_todos', name: '更新执行任务' },
      { code: 'delete_todos', name: '删除执行任务' },
    ],
  },
  {
    group: '系统设置',
    items: [
      { code: 'view_settings', name: '查看系统设置' },
      { code: 'manage_users', name: '管理用户' },
      { code: 'manage_roles', name: '管理角色' },
      { code: 'manage_orgs', name: '管理组织' },
    ],
  },
  {
    group: 'Skill管理',
    items: [
      { code: 'use_skills', name: '使用Skill' },
      { code: 'manage_skills', name: '管理Skill' },
    ],
  },
]

// ── GET /api/menus ──
router.get('/menus', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM menus ORDER BY sort_order').all() as any[]
    res.json(buildMenuTree(rows))
  } catch (err) {
    console.error('[RBAC] menus error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

function buildMenuTree(rows: any[], parentId: string = ''): any[] {
  return rows
    .filter((r: any) => (r.parent_id || '') === parentId)
    .map((r: any) => ({
      id: r.id,
      label: r.label,
      path: r.path,
      icon: r.icon,
      children: buildMenuTree(rows, r.id),
    }))
}

// ── GET /api/operations ──
router.get('/operations', (_req, res) => {
  res.json(operationGroups)
})

// ── GET /api/scope-fields ──
router.get('/scope-fields', (_req, res) => {
  res.json(scopeFieldMeta)
})

// ═══════════════════════════════════════════════
//  ORGS
// ═══════════════════════════════════════════════

router.get('/orgs', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM orgs c WHERE c.parent_id = o.id) as children_count,
             (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) as user_count
      FROM orgs o ORDER BY o.sort_order
    `).all()
    res.json(rows)
  } catch (err) {
    console.error('[RBAC] orgs list error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.get('/orgs/tree', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM orgs ORDER BY sort_order').all() as any[]
    res.json(buildOrgTree(rows))
  } catch (err) {
    console.error('[RBAC] orgs tree error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

function buildOrgTree(rows: any[], parentId: string = ''): any[] {
  return rows
    .filter((r: any) => (r.parent_id || '') === parentId)
    .map((r: any) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id || '',
      sortOrder: r.sort_order,
      children: buildOrgTree(rows, r.id),
    }))
}

router.post('/orgs', requireOperation('manage_orgs'), (req, res) => {
  try {
    const db = getDb()
    const { name, parent_id, sort_order } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }

    const id = generateId('org')
    db.prepare('INSERT INTO orgs (id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)')
      .run(id, name, parent_id || '', sort_order || 0)
    res.json({ id, name, parent_id: parent_id || '', sort_order: sort_order || 0 })
  } catch (err) {
    console.error('[RBAC] org create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.put('/orgs/:id', requireOperation('manage_orgs'), (req, res) => {
  try {
    const db = getDb()
    const { name, parent_id, sort_order } = req.body
    const existing = db.prepare('SELECT * FROM orgs WHERE id = ?').get(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Org not found' }); return }

    const updates: string[] = []
    const values: any[] = []
    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (parent_id !== undefined) { updates.push('parent_id = ?'); values.push(parent_id) }
    if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order) }

    if (updates.length > 0) {
      values.push(req.params.id)
      db.prepare(`UPDATE orgs SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] org update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.delete('/orgs/:id', requireOperation('manage_orgs'), (req, res) => {
  try {
    const db = getDb()
    if (req.params.id === 'org_root') { res.status(400).json({ error: 'Cannot delete root org' }); return }

    const childCount = (db.prepare('SELECT COUNT(*) as c FROM orgs WHERE parent_id = ?').get(req.params.id) as any)?.c || 0
    if (childCount > 0) { res.status(400).json({ error: 'Cannot delete org with children' }); return }

    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE org_id = ?').get(req.params.id) as any)?.c || 0
    if (userCount > 0) { res.status(400).json({ error: 'Cannot delete org with users' }); return }

    db.prepare('DELETE FROM orgs WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] org delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ═══════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════

router.get('/users', (req, res) => {
  try {
    const db = getDb()
    let where = 'WHERE 1=1'
    const params: any[] = []

    const { org_id, search, enabled } = req.query
    if (org_id && typeof org_id === 'string') {
      where += ' AND u.org_id = ?'
      params.push(org_id)
    }
    if (search && typeof search === 'string') {
      const q = `%${search.toLowerCase()}%`
      where += ' AND (LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ?)'
      params.push(q, q)
    }
    if (enabled && typeof enabled === 'string') {
      where += ' AND u.enabled = ?'
      params.push(enabled === 'true' ? 1 : 0)
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM users u ${where}`
    ).get(...params) as any
    const total = countRow?.total || 0

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1)
    const pageSize = Math.max(1, parseInt(req.query.pageSize as string, 10) || 20)
    const offset = (page - 1) * pageSize

    const rows = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.org_id, o.name as org_name,
              u.email, u.phone, u.enabled, u.created_at
       FROM users u
       LEFT JOIN orgs o ON u.org_id = o.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset)

    res.json({ data: rows, total, page, pageSize })
  } catch (err) {
    console.error('[RBAC] users list error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.post('/users', requireOperation('manage_users'), (req, res) => {
  try {
    const db = getDb()
    const { username, display_name, password, org_id, email, phone } = req.body
    if (!username || !display_name || !password) {
      res.status(400).json({ error: 'username, display_name, password are required' })
      return
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) { res.status(400).json({ error: 'Username already exists' }); return }

    const id = generateId('user')
    db.prepare(
      'INSERT INTO users (id, username, display_name, password_hash, org_id, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, username, display_name, hashPassword(password), org_id || '', email || '', phone || '')

    res.json({ id, username, display_name, org_id: org_id || '', email: email || '', phone: phone || '' })
  } catch (err) {
    console.error('[RBAC] user create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.put('/users/:id', requireOperation('manage_users'), (req, res) => {
  try {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
    if (!existing) { res.status(404).json({ error: 'User not found' }); return }

    const { username, display_name, password, org_id, email, phone, enabled } = req.body
    const updates: string[] = []
    const values: any[] = []

    if (username !== undefined) {
      const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.params.id)
      if (dup) { res.status(400).json({ error: 'Username already exists' }); return }
      updates.push('username = ?'); values.push(username)
    }
    if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name) }
    if (password !== undefined && password !== '') { updates.push('password_hash = ?'); values.push(hashPassword(password)) }
    if (org_id !== undefined) { updates.push('org_id = ?'); values.push(org_id) }
    if (email !== undefined) { updates.push('email = ?'); values.push(email) }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone) }
    if (enabled !== undefined) { updates.push('enabled = ?'); values.push(enabled ? 1 : 0) }

    if (updates.length > 0) {
      values.push(req.params.id)
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] user update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.delete('/users/:id', requireOperation('manage_users'), (req, res) => {
  try {
    const db = getDb()
    if (req.params.id === 'user_admin') { res.status(400).json({ error: 'Cannot delete admin user' }); return }
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] user delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// User roles
router.get('/users/:id/roles', (req, res) => {
  try {
    const db = getDb()
    const roles = db.prepare(
      'SELECT r.id, r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?'
    ).all(req.params.id)
    res.json(roles)
  } catch (err) {
    console.error('[RBAC] user roles error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.put('/users/:id/roles', requireOperation('manage_users'), (req, res) => {
  try {
    const db = getDb()
    const { roleIds } = req.body
    if (!Array.isArray(roleIds)) { res.status(400).json({ error: 'roleIds array is required' }); return }

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(req.params.id)
      const insert = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
      for (const roleId of roleIds) {
        insert.run(req.params.id, roleId)
      }
    })
    transaction()
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] user roles update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ═══════════════════════════════════════════════
//  ROLES
// ═══════════════════════════════════════════════

router.get('/roles', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as user_count
      FROM roles r ORDER BY r.created_at
    `).all()
    res.json(rows)
  } catch (err) {
    console.error('[RBAC] roles list error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.post('/roles', requireOperation('manage_roles'), (req, res) => {
  try {
    const db = getDb()
    const { name, description } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }

    const id = generateId('role')
    db.prepare('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)')
      .run(id, name, description || '')
    res.json({ id, name, description: description || '' })
  } catch (err) {
    console.error('[RBAC] role create error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.put('/roles/:id', requireOperation('manage_roles'), (req, res) => {
  try {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Role not found' }); return }

    const { name, description } = req.body
    const updates: string[] = []
    const values: any[] = []
    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }

    if (updates.length > 0) {
      values.push(req.params.id)
      db.prepare(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] role update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.delete('/roles/:id', requireOperation('manage_roles'), (req, res) => {
  try {
    const db = getDb()
    if (req.params.id === 'role_admin') { res.status(400).json({ error: 'Cannot delete admin role' }); return }
    db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] role delete error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Role Permissions ──

router.get('/roles/:id/permissions', (req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      'SELECT * FROM role_permissions WHERE role_id = ?'
    ).all(req.params.id) as any[]

    const menus: string[] = []
    const operations: string[] = []
    const dataScopes: Record<string, string> = {}

    for (const r of rows) {
      if (r.permission_type === 'menu') menus.push(r.resource_id)
      else if (r.permission_type === 'operation') operations.push(r.resource_id)
      else if (r.permission_type === 'data' && r.extra) {
        try { Object.assign(dataScopes, JSON.parse(r.extra)) } catch { /* ignore */ }
      }
    }

    res.json({ menus, operations, dataScopes })
  } catch (err) {
    console.error('[RBAC] role permissions error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.put('/roles/:id/permissions', requireOperation('manage_roles'), (req, res) => {
  try {
    const db = getDb()
    const { menus, operations, dataScopes } = req.body
    const roleId = req.params.id

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
      const insert = db.prepare(
        'INSERT INTO role_permissions (id, role_id, permission_type, resource_id, extra) VALUES (?, ?, ?, ?, ?)'
      )

      if (Array.isArray(menus)) {
        for (const menuId of menus) {
          insert.run(generateId('perm'), roleId, 'menu', menuId, '')
        }
      }
      if (Array.isArray(operations)) {
        for (const code of operations) {
          insert.run(generateId('perm'), roleId, 'operation', code, '')
        }
      }
      if (dataScopes && typeof dataScopes === 'object') {
        for (const [resource, scope] of Object.entries(dataScopes)) {
          if (!scope) continue
          // Store structured rules or raw SQL
          if (typeof scope === 'object' && (scope as any).rules && Array.isArray((scope as any).rules)) {
            const validRules = (scope as any).rules.filter((r: any) => r.field && r.value)
            if (validRules.length > 0) {
              const entry = { [resource]: { rules: validRules, logic: (scope as any).logic || 'AND' } }
              insert.run(generateId('perm'), roleId, 'data', resource, JSON.stringify(entry))
            }
          } else if (typeof scope === 'string' && scope.trim()) {
            insert.run(generateId('perm'), roleId, 'data', resource, JSON.stringify({ [resource]: scope.trim() }))
          }
        }
      }
    })
    transaction()
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] role permissions update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── Role Skill Permissions ──

router.get('/roles/:id/skill-permissions', (req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      "SELECT resource_id FROM role_permissions WHERE role_id = ? AND permission_type = 'skill'"
    ).all(req.params.id) as any[]
    res.json({ skillIds: rows.map((r: any) => r.resource_id) })
  } catch (err) {
    console.error('[RBAC] skill permissions error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

router.put('/roles/:id/skill-permissions', requireOperation('manage_roles'), (req, res) => {
  try {
    const db = getDb()
    const { skillIds } = req.body
    if (!Array.isArray(skillIds)) { res.status(400).json({ error: 'skillIds array is required' }); return }

    const roleId = req.params.id
    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission_type = 'skill'").run(roleId)
      const insert = db.prepare('INSERT INTO role_permissions (id, role_id, permission_type, resource_id) VALUES (?, ?, ?, ?)')
      for (const skillId of skillIds) {
        insert.run(generateId('perm'), roleId, 'skill', skillId)
      }
    })
    transaction()
    res.json({ success: true })
  } catch (err) {
    console.error('[RBAC] skill permissions update error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

export { operationGroups }
export default router
