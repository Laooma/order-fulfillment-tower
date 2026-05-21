import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'analysis.db')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dir = path.dirname(DB_PATH)
    const fs = require('fs')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
  }
  return db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      agent TEXT DEFAULT '',
      initiator TEXT DEFAULT '系统',
      status TEXT DEFAULT 'analyzing',
      created_at TEXT NOT NULL,
      completed_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS analysis_orders (
      id TEXT PRIMARY KEY,
      analysis_task_id TEXT NOT NULL REFERENCES analysis_tasks(id) ON DELETE CASCADE,
      contract_number TEXT NOT NULL DEFAULT '',
      customer TEXT DEFAULT '',
      amount TEXT DEFAULT '0',
      shipment_ratio REAL DEFAULT 0,
      status TEXT DEFAULT '待发货',
      status_class TEXT DEFAULT 'blue',
      sales TEXT DEFAULT '',
      region TEXT DEFAULT '',
      order_date TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS analysis_problem_categories (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES analysis_orders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS analysis_problems (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES analysis_problem_categories(id) ON DELETE CASCADE,
      material_code TEXT DEFAULT '',
      material_name TEXT DEFAULT '',
      part_name TEXT DEFAULT '',
      part_number TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      status TEXT DEFAULT '待处理'
    );

    CREATE TABLE IF NOT EXISTS analysis_todos (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES analysis_orders(id) ON DELETE CASCADE,
      category TEXT DEFAULT '',
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium',
      assignee TEXT DEFAULT '',
      supervisor TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      task_type TEXT DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS analysis_delivery_tables (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES analysis_orders(id) ON DELETE CASCADE,
      title TEXT DEFAULT '',
      badge TEXT DEFAULT 'BPM',
      items_json TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS analysis_card_details (
      id TEXT PRIMARY KEY,
      problem_id TEXT NOT NULL REFERENCES analysis_problems(id) ON DELETE CASCADE,
      material_info_json TEXT DEFAULT '{}',
      ai_analysis TEXT DEFAULT '',
      delivery_path_json TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      org_id TEXT DEFAULT '' REFERENCES orgs(id),
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_type TEXT NOT NULL CHECK(permission_type IN ('menu', 'operation', 'data', 'skill')),
      resource_id TEXT NOT NULL,
      extra TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS menus (
      id TEXT PRIMARY KEY,
      parent_id TEXT DEFAULT '',
      label TEXT NOT NULL,
      path TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('email', 'wecom', 'feishu', 'feishu_app')),
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      variables TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL DEFAULT '',
      channel_type TEXT NOT NULL DEFAULT '',
      send_to TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      detail TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      template_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `)

  // Migration: add supervisor column if missing
  try { db.exec('ALTER TABLE analysis_todos ADD COLUMN supervisor TEXT DEFAULT \'\'') } catch (_) { /* already exists */ }

  // Migration: update role_permissions CHECK constraint to include 'skill'
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS role_permissions_new (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_type TEXT NOT NULL CHECK(permission_type IN ('menu', 'operation', 'data', 'skill')),
        resource_id TEXT NOT NULL,
        extra TEXT DEFAULT ''
      );
      INSERT INTO role_permissions_new SELECT * FROM role_permissions;
      DROP TABLE role_permissions;
      ALTER TABLE role_permissions_new RENAME TO role_permissions;
    `)
  } catch (_) { /* migration already applied */ }

  // Migration: update notification_channels CHECK constraint to include 'feishu_app'
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_channels_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('email', 'wecom', 'feishu', 'feishu_app')),
        config_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      INSERT INTO notification_channels_new SELECT * FROM notification_channels;
      DROP TABLE notification_channels;
      ALTER TABLE notification_channels_new RENAME TO notification_channels;
    `)
  } catch (_) { /* migration already applied */ }

  seedRbac(db)
}

function seedRbac(db: Database.Database) {
  // Seed root org if not exists
  const orgCount = (db.prepare('SELECT COUNT(*) as c FROM orgs').get() as any)?.c || 0
  if (orgCount === 0) {
    db.prepare(`INSERT INTO orgs (id, name, parent_id, sort_order) VALUES ('org_root', '根组织', '', 0)`).run()

    // Seed admin role
    db.prepare(`INSERT INTO roles (id, name, description) VALUES ('role_admin', '系统管理员', '拥有全部权限')`).run()

    // Seed admin user (password: 123456)
    const crypto = require('crypto')
    const hash = crypto.createHash('sha256').update('123456').digest('hex')
    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, org_id) VALUES ('user_admin', 'admin', '管理员', ?, 'org_root')`).run(hash)

    // Assign admin role to admin user
    db.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES ('user_admin', 'role_admin')`).run()

    // Seed menus
    const menus = [
      { id: 'menu_home', parent_id: '', label: '首页', path: '/', icon: 'Home', sort_order: 1 },
      { id: 'menu_analysis', parent_id: '', label: '分析任务', path: '/history', icon: 'Search', sort_order: 2 },
      { id: 'menu_tasks', parent_id: '', label: '任务列表', path: '/tasks', icon: 'ListChecks', sort_order: 3 },
      { id: 'menu_settings', parent_id: '', label: '系统设置', path: '/settings', icon: 'Settings', sort_order: 4 },
      { id: 'menu_settings_llm', parent_id: 'menu_settings', label: '大模型接入点', path: '/settings', icon: 'Cpu', sort_order: 1 },
      { id: 'menu_settings_skills', parent_id: 'menu_settings', label: 'Skill 管理', path: '/settings', icon: 'FileText', sort_order: 2 },
      { id: 'menu_settings_org', parent_id: 'menu_settings', label: '组织机构', path: '/settings', icon: 'Building2', sort_order: 3 },
      { id: 'menu_settings_users', parent_id: 'menu_settings', label: '用户管理', path: '/settings', icon: 'Users', sort_order: 4 },
      { id: 'menu_settings_roles', parent_id: 'menu_settings', label: '角色与权限', path: '/settings', icon: 'Shield', sort_order: 5 },
    ]
    const insertMenu = db.prepare(`INSERT INTO menus (id, parent_id, label, path, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
    for (const m of menus) {
      insertMenu.run(m.id, m.parent_id, m.label, m.path, m.icon, m.sort_order)
    }

    // Grant all permissions to admin role
    const insertPerm = db.prepare(`INSERT INTO role_permissions (id, role_id, permission_type, resource_id) VALUES (?, ?, ?, ?)`)
    // All menu permissions
    for (const m of menus) {
      insertPerm.run(`perm_menu_${m.id}`, 'role_admin', 'menu', m.id)
    }
    // All operation permissions
    const opCodes = [
      'view_orders', 'export_orders', 'edit_orders',
      'view_analysis', 'create_analysis', 'delete_analysis',
      'view_todos', 'assign_todos', 'update_todos', 'delete_todos',
      'view_settings', 'manage_users', 'manage_roles', 'manage_orgs',
      'use_skills', 'manage_skills',
    ]
    for (const code of opCodes) {
      insertPerm.run(`perm_op_${code}`, 'role_admin', 'operation', code)
    }
  }
}

// ── Query helpers ──

export function getAnalysisFull(taskId: string) {
  const d = getDb()

  const task = d.prepare('SELECT * FROM analysis_tasks WHERE id = ?').get(taskId) as any
  if (!task) return null

  const orders = d.prepare('SELECT * FROM analysis_orders WHERE analysis_task_id = ?').all(taskId) as any[]

  const result: any = {
    ...task,
    orders: orders.map((order: any) => {
      const categories = d.prepare(
        'SELECT * FROM analysis_problem_categories WHERE order_id = ? ORDER BY sort_order'
      ).all(order.id) as any[]

      const todos = d.prepare(
        'SELECT * FROM analysis_todos WHERE order_id = ?'
      ).all(order.id) as any[]

      const deliveryTables = d.prepare(
        'SELECT * FROM analysis_delivery_tables WHERE order_id = ?'
      ).all(order.id) as any[]

      return {
        ...order,
        problemCategories: categories.map((cat: any) => {
          const problems = d.prepare(
            'SELECT * FROM analysis_problems WHERE category_id = ?'
          ).all(cat.id) as any[]

          return {
            ...cat,
            cards: problems.map((p: any) => {
              const detail = d.prepare(
                'SELECT * FROM analysis_card_details WHERE problem_id = ?'
              ).get(p.id) as any
              return {
                ...p,
                tags: JSON.parse(p.tags || '[]'),
                cardDetail: detail ? {
                  materialInfo: JSON.parse(detail.material_info_json || '{}'),
                  aiAnalysis: detail.ai_analysis || '',
                  deliveryPath: JSON.parse(detail.delivery_path_json || '[]'),
                } : null,
              }
            }),
          }
        }),
        todos: todos.map((t: any) => ({
          ...t,
        })),
        deliveryTables: deliveryTables.map((dt: any) => ({
          ...dt,
          items: JSON.parse(dt.items_json || '[]'),
        })),
      }
    }),
  }

  return result
}

export function saveAnalysisResult(taskId: string, parsed: {
  title?: string
  agent?: string
  orders: Array<{
    contractNumber: string
    customer: string
    amount: string
    shipmentRatio: number
    status: string
    statusClass: string
    sales: string
    region: string
    orderDate: string
    problemCategories: Array<{
      name: string
      type: number
      problems: Array<{
        materialCode: string
        materialName: string
        partName: string
        partNumber: string
        tags: Array<{ label: string; variant: string }>
      }>
    }>
    todos?: Array<{
      category: string
      description: string
      priority: string
      assignee: string
      dueDate: string
      status: string
      taskType: string
    }>
    deliveryTables?: Array<{
      title: string
      badge: string
      items: Array<{
        docNo: string
        status: string
        lineNo: string
        sign: string
        qty: number
      }>
    }>
  }>
}) {
  const d = getDb()

  const insertOrder = d.prepare(`
    INSERT OR REPLACE INTO analysis_orders (id, analysis_task_id, contract_number, customer, amount, shipment_ratio, status, status_class, sales, region, order_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCategory = d.prepare(`
    INSERT OR REPLACE INTO analysis_problem_categories (id, order_id, name, type, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `)
  const insertProblem = d.prepare(`
    INSERT OR REPLACE INTO analysis_problems (id, category_id, material_code, material_name, part_name, part_number, tags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTodo = d.prepare(`
    INSERT OR REPLACE INTO analysis_todos (id, order_id, category, description, priority, assignee, due_date, status, task_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertDelivery = d.prepare(`
    INSERT OR REPLACE INTO analysis_delivery_tables (id, order_id, title, badge, items_json)
    VALUES (?, ?, ?, ?, ?)
  `)

  const transaction = d.transaction(() => {
    // Update task title/agent if provided
    if (parsed.title || parsed.agent) {
      const updates: string[] = []
      const values: any[] = []
      if (parsed.title) { updates.push('title = ?'); values.push(parsed.title) }
      if (parsed.agent) { updates.push('agent = ?'); values.push(parsed.agent) }
      values.push(taskId)
      d.prepare(`UPDATE analysis_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }

    for (const order of parsed.orders) {
      const orderId = `${taskId}_${order.contractNumber}`
      insertOrder.run(
        orderId, taskId,
        order.contractNumber, order.customer, order.amount,
        order.shipmentRatio, order.status, order.statusClass,
        order.sales, order.region, order.orderDate
      )

      // Delete old categories/problems for this order (to replace with new)
      d.prepare('DELETE FROM analysis_problem_categories WHERE order_id = ?').run(orderId)

      order.problemCategories.forEach((cat, ci) => {
        const catId = `${orderId}_cat_${ci}`
        insertCategory.run(catId, orderId, cat.name, cat.type, ci)

        cat.problems.forEach((prob, pi) => {
          const probId = `${catId}_prob_${pi}`
          insertProblem.run(
            probId, catId,
            prob.materialCode, prob.materialName, prob.partName, prob.partNumber,
            JSON.stringify(prob.tags), '待处理'
          )

          // Save card-level detail if present
          if ((prob as any).cardDetail) {
            const cd = (prob as any).cardDetail
            d.prepare(`
              INSERT OR REPLACE INTO analysis_card_details (id, problem_id, material_info_json, ai_analysis, delivery_path_json)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              `${probId}_detail`, probId,
              JSON.stringify(cd.materialInfo || {}),
              cd.aiAnalysis || '',
              JSON.stringify(cd.deliveryPath || [])
            )
          }
        })
      })

      // Todos
      if (order.todos) {
        d.prepare('DELETE FROM analysis_todos WHERE order_id = ?').run(orderId)
        order.todos.forEach((todo, ti) => {
          const todoId = `${orderId}_todo_${ti}`
          insertTodo.run(
            todoId, orderId,
            todo.category, todo.description, todo.priority,
            todo.assignee, todo.dueDate, todo.status, todo.taskType
          )
        })
      }

      // Delivery tables
      if (order.deliveryTables) {
        d.prepare('DELETE FROM analysis_delivery_tables WHERE order_id = ?').run(orderId)
        order.deliveryTables.forEach((dt, dti) => {
          const dtId = `${orderId}_dt_${dti}`
          insertDelivery.run(dtId, orderId, dt.title, dt.badge, JSON.stringify(dt.items))
        })
      }
    }
  })

  transaction()
  return { success: true }
}

export function updateTaskStatus(taskId: string, status: string): boolean {
  const d = getDb()
  const result = d.prepare('UPDATE analysis_tasks SET status = ?, completed_at = ? WHERE id = ?')
    .run(status, status === 'completed' ? new Date().toLocaleString('zh-CN') : '', taskId)
  return result.changes > 0
}

export function getTaskStatus(taskId: string): string | null {
  const d = getDb()
  const row = d.prepare('SELECT status FROM analysis_tasks WHERE id = ?').get(taskId) as any
  return row?.status || null
}

export function getCardDetail(taskId: string, problemId: string) {
  const d = getDb()

  const problem = d.prepare(`
    SELECT ap.*, apc.name as category_name, apc.type as category_type,
           ao.contract_number, ao.customer
    FROM analysis_problems ap
    JOIN analysis_problem_categories apc ON ap.category_id = apc.id
    JOIN analysis_orders ao ON apc.order_id = ao.id
    WHERE ap.id = ? AND ao.analysis_task_id = ?
  `).get(problemId, taskId) as any

  if (!problem) return null

  const detail = d.prepare(
    'SELECT * FROM analysis_card_details WHERE problem_id = ?'
  ).get(problemId) as any

  return {
    ...problem,
    tags: JSON.parse(problem.tags || '[]'),
    cardDetail: detail ? {
      materialInfo: JSON.parse(detail.material_info_json || '{}'),
      aiAnalysis: detail.ai_analysis || '',
      deliveryPath: JSON.parse(detail.delivery_path_json || '[]'),
    } : null,
  }
}

export function saveCardDetail(problemId: string, detail: {
  materialInfo?: Record<string, string>
  aiAnalysis?: string
  deliveryPath?: Array<{
    docType: string
    docNo: string
    badge: string
    qty: number
    status: string
    problemPoint: string
  }>
}) {
  const d = getDb()
  d.prepare(`
    INSERT OR REPLACE INTO analysis_card_details (id, problem_id, material_info_json, ai_analysis, delivery_path_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    `${problemId}_detail`,
    problemId,
    JSON.stringify(detail.materialInfo || {}),
    detail.aiAnalysis || '',
    JSON.stringify(detail.deliveryPath || [])
  )
  return { success: true }
}

// ── Chat message helpers ──

export function getChatMessages(sessionId: string): Array<{ id: number; role: string; content: string; created_at: string }> {
  const d = getDb()
  return d.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId) as any[]
}

export function saveChatMessage(sessionId: string, role: string, content: string) {
  const d = getDb()
  d.prepare(
    'INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)'
  ).run(sessionId, role, content)
}

export function saveChatMessages(sessionId: string, messages: Array<{ role: string; content: string }>) {
  const d = getDb()
  const insert = d.prepare(
    'INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)'
  )
  const transaction = d.transaction(() => {
    // Clear existing messages for this session to avoid duplicates
    d.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId)
    for (const msg of messages) {
      insert.run(sessionId, msg.role, msg.content)
    }
  })
  transaction()
  return { success: true, count: messages.length }
}

// ── Notification channel helpers ──

export function listNotificationChannels() {
  const d = getDb()
  return d.prepare('SELECT * FROM notification_channels ORDER BY created_at ASC').all() as any[]
}

export function getNotificationChannel(id: string) {
  const d = getDb()
  return d.prepare('SELECT * FROM notification_channels WHERE id = ?').get(id) as any
}

export function createNotificationChannel(data: { id: string; name: string; type: string; config_json?: string }) {
  const d = getDb()
  d.prepare(`
    INSERT INTO notification_channels (id, name, type, config_json)
    VALUES (?, ?, ?, ?)
  `).run(data.id, data.name, data.type, data.config_json || '{}')
  return { success: true }
}

export function updateNotificationChannel(id: string, data: { name?: string; config_json?: string; enabled?: number }) {
  const d = getDb()
  const updates: string[] = []
  const values: any[] = []
  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
  if (data.config_json !== undefined) { updates.push('config_json = ?'); values.push(data.config_json) }
  if (data.enabled !== undefined) { updates.push('enabled = ?'); values.push(data.enabled) }
  if (updates.length === 0) return { success: false, error: 'No fields to update' }
  updates.push("updated_at = datetime('now','localtime')")
  values.push(id)
  const result = d.prepare(`UPDATE notification_channels SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return { success: result.changes > 0 }
}

export function deleteNotificationChannel(id: string) {
  const d = getDb()
  const result = d.prepare('DELETE FROM notification_channels WHERE id = ?').run(id)
  return { success: result.changes > 0 }
}

// ── Notification Templates ──

export function listNotificationTemplates() {
  const d = getDb()
  return d.prepare('SELECT * FROM notification_templates ORDER BY created_at DESC').all()
}

export function getNotificationTemplate(id: string) {
  const d = getDb()
  return d.prepare('SELECT * FROM notification_templates WHERE id = ?').get(id)
}

export function createNotificationTemplate(data: { id: string; name: string; subject?: string; body?: string; variables?: string }) {
  const d = getDb()
  d.prepare(`INSERT INTO notification_templates (id, name, subject, body, variables) VALUES (?, ?, ?, ?, ?)`)
    .run(data.id, data.name, data.subject || '', data.body || '', data.variables || '[]')
  return { success: true }
}

export function updateNotificationTemplate(id: string, data: { name?: string; subject?: string; body?: string; variables?: string }) {
  const d = getDb()
  const updates: string[] = []
  const values: any[] = []
  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
  if (data.subject !== undefined) { updates.push('subject = ?'); values.push(data.subject) }
  if (data.body !== undefined) { updates.push('body = ?'); values.push(data.body) }
  if (data.variables !== undefined) { updates.push('variables = ?'); values.push(data.variables) }
  if (updates.length === 0) return { success: false }
  updates.push("updated_at = datetime('now','localtime')")
  values.push(id)
  const result = d.prepare(`UPDATE notification_templates SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return { success: result.changes > 0 }
}

export function deleteNotificationTemplate(id: string) {
  const d = getDb()
  const result = d.prepare('DELETE FROM notification_templates WHERE id = ?').run(id)
  return { success: result.changes > 0 }
}

// ── Notification Logs ──

export function insertNotificationLog(data: {
  channel_id: string; channel_name: string; channel_type: string;
  send_to: string; subject: string; message: string;
  success: number; detail: string; error: string; template_id?: string;
}) {
  const d = getDb()
  d.prepare(`INSERT INTO notification_logs (channel_id, channel_name, channel_type, send_to, subject, message, success, detail, error, template_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.channel_id, data.channel_name, data.channel_type, data.send_to, data.subject, data.message,
      data.success, data.detail, data.error, data.template_id || '')
}

export function listNotificationLogs(params: { channelId?: string; success?: number; page?: number; pageSize?: number }) {
  const d = getDb()
  const conditions: string[] = []
  const values: any[] = []
  if (params.channelId) { conditions.push('channel_id = ?'); values.push(params.channelId) }
  if (params.success !== undefined) { conditions.push('success = ?'); values.push(params.success) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const page = params.page || 1
  const pageSize = params.pageSize || 20
  const offset = (page - 1) * pageSize
  const total = (d.prepare(`SELECT COUNT(*) as c FROM notification_logs ${where}`).get(...values) as any)?.c || 0
  const data = d.prepare(`SELECT * FROM notification_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset)
  return { data, total, page, pageSize }
}

export function getLastLogByChannel(channelId: string) {
  const d = getDb()
  return d.prepare('SELECT * FROM notification_logs WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1').get(channelId) as any
}
