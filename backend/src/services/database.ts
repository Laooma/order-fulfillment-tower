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
    runMigrations(db)
    seedBizData(db)
  }
  return db
}

function runMigrations(d: Database.Database) {
  // Add tool_call_id / tool_calls_json columns to chat_messages (added for tool message support)
  for (const [col, def] of [['tool_call_id', "TEXT DEFAULT ''"], ['tool_calls_json', "TEXT DEFAULT '[]'"]]) {
    const exists = d.prepare(`SELECT name FROM pragma_table_info('chat_messages') WHERE name = ?`).get(col)
    if (!exists) {
      d.exec(`ALTER TABLE chat_messages ADD COLUMN ${col} ${def}`)
    }
  }
  // Add a2ui_data column to analysis_tasks
  {
    const exists = d.prepare(`SELECT name FROM pragma_table_info('analysis_tasks') WHERE name = 'a2ui_data'`).get()
    if (!exists) {
      d.exec(`ALTER TABLE analysis_tasks ADD COLUMN a2ui_data TEXT DEFAULT ''`)
    }
  }
}

function seedBizData(d: Database.Database) {
  const count = (d.prepare('SELECT COUNT(*) as c FROM biz_contracts').get() as any)?.c || 0
  if (count > 0) return

  console.log('[DB] Seeding biz data...')

  const now = new Date()
  const fmt = (d: Date) => `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
  const fmtISO = (d: Date) => d.toISOString().slice(0, 10)

  // ── 5 contracts ──
  const contracts = [
    { id: 'SC-2025-001', no: 'HT-SC-2025-001', cust: '上海成套厂', sign: '2025/01/15', status: '执行中', amt: 850 },
    { id: 'SC-2025-002', no: 'HT-SC-2025-002', cust: '江苏成套厂', sign: '2025/02/20', status: '执行中', amt: 620 },
    { id: 'SC-2025-003', no: 'HT-SC-2025-003', cust: '浙江成套厂', sign: '2025/03/10', status: '执行中', amt: 1200 },
    { id: 'SC-2025-004', no: 'HT-SC-2025-004', cust: '广东成套厂', sign: '2025/01/28', status: '执行中', amt: 450 },
    { id: 'SC-2025-005', no: 'HT-SC-2025-005', cust: '安徽成套厂', sign: '2025/04/05', status: '执行中', amt: 980 },
  ]

  // ── Devices per contract ──
  const deviceTypes = [
    { name: '控制系统装置', code: 'CTRL' },
    { name: '配电柜装置', code: 'PD' },
    { name: '变频驱动装置', code: 'VFD' },
    { name: '仪表监测装置', code: 'INST' },
    { name: '辅助供电装置', code: 'AUX' },
  ]

  // ── Package types ──
  const packageTypes = [
    { name: '控制柜包', code: 'CTRL-CAB' },
    { name: '线缆包', code: 'CABLE' },
    { name: '端子排包', code: 'TERM' },
    { name: '电源模块包', code: 'PWR' },
    { name: '通讯模块包', code: 'COMM' },
    { name: '保护装置包', code: 'PROT' },
    { name: '测量仪表包', code: 'MEAS' },
    { name: '安装附件包', code: 'MNT' },
  ]

  // ── Materials pool ──
  const materialPool = [
    { code: 'DLQ-001', name: '塑壳断路器', spec: 'NSX250F 3P 250A', unit: '个', supplier: '施耐德电气', lead: 45 },
    { code: 'DLQ-002', name: '微型断路器', spec: 'iC65N 2P 32A', unit: '个', supplier: '施耐德电气', lead: 30 },
    { code: 'DLQ-003', name: '框架断路器', spec: 'MT40H1 3P 4000A', unit: '台', supplier: '施耐德电气', lead: 60 },
    { code: 'JDQ-001', name: '中间继电器', spec: 'RXM4AB2BD 24VDC', unit: '个', supplier: '施耐德电气', lead: 21 },
    { code: 'JDQ-002', name: '时间继电器', spec: 'RE22R1AMR 24-240V', unit: '个', supplier: '施耐德电气', lead: 28 },
    { code: 'JCQ-001', name: '交流接触器', spec: 'LC1D80M7C 80A', unit: '个', supplier: '施耐德电气', lead: 35 },
    { code: 'JCQ-002', name: '直流接触器', spec: 'LP1K0901BD 24VDC', unit: '个', supplier: '施耐德电气', lead: 35 },
    { code: 'BP-001', name: '变频器', spec: 'ATV630D45N4 45kW', unit: '台', supplier: '施耐德电气', lead: 60 },
    { code: 'BP-002', name: '软启动器', spec: 'ATS48D62Q 30kW', unit: '台', supplier: '施耐德电气', lead: 50 },
    { code: 'PL-001', name: 'PLC控制器', spec: 'M580 BMEP584040', unit: '台', supplier: '施耐德电气', lead: 45 },
    { code: 'PL-002', name: 'I/O模块', spec: 'BMXDDI6402K', unit: '个', supplier: '施耐德电气', lead: 30 },
    { code: 'DZ-001', name: '接线端子', spec: 'UK2.5B 2.5mm²', unit: '片', supplier: '菲尼克斯', lead: 14 },
    { code: 'DZ-002', name: '保险端子', spec: 'UK5-HESI 5A', unit: '片', supplier: '菲尼克斯', lead: 14 },
    { code: 'DY-001', name: '开关电源', spec: 'SDR-240-24 240W', unit: '台', supplier: '明纬', lead: 21 },
    { code: 'DY-002', name: 'UPS电源', spec: '3KVA 在线式', unit: '台', supplier: '山特', lead: 30 },
    { code: 'TX-001', name: '屏蔽电缆', spec: 'RVVP 4×1.5mm²', unit: '米', supplier: '远东电缆', lead: 15 },
    { code: 'TX-002', name: '控制电缆', spec: 'KVVP 7×1.5mm²', unit: '米', supplier: '远东电缆', lead: 15 },
    { code: 'TX-003', name: '电力电缆', spec: 'YJV 3×70+1×35mm²', unit: '米', supplier: '远东电缆', lead: 20 },
    { code: 'YB-001', name: '电流互感器', spec: 'LMZ1-0.66 300/5A', unit: '个', supplier: '正泰电器', lead: 21 },
    { code: 'YB-002', name: '电压互感器', spec: 'JDZ-10 10kV/100V', unit: '台', supplier: '正泰电器', lead: 28 },
    { code: 'YB-003', name: '多功能电力仪表', spec: 'PD194Z-9S4', unit: '台', supplier: '正泰电器', lead: 21 },
    { code: 'KG-001', name: '转换开关', spec: 'LW5D-16/2', unit: '个', supplier: '正泰电器', lead: 14 },
    { code: 'KG-002', name: '按钮开关', spec: 'LAY50-22D 红/绿', unit: '个', supplier: '正泰电器', lead: 7 },
    { code: 'KG-003', name: '急停按钮', spec: 'LAY50-22Z 红', unit: '个', supplier: '正泰电器', lead: 7 },
    { code: 'RD-001', name: '熔断器', spec: 'RT28N-32 32A', unit: '个', supplier: '正泰电器', lead: 10 },
    { code: 'BL-001', name: '避雷器', spec: 'SPD AC 3P+N', unit: '台', supplier: '菲尼克斯', lead: 21 },
    { code: 'GL-001', name: '隔离变压器', spec: 'BK-1000VA 380/220V', unit: '台', supplier: '上海变压器厂', lead: 35 },
    { code: 'FS-001', name: '散热风扇', spec: '120×120×38mm 24VDC', unit: '个', supplier: '台达', lead: 10 },
    { code: 'LX-001', name: '柜体线槽', spec: '60×80mm PVC', unit: '米', supplier: '上海电器', lead: 7 },
    { code: 'LX-002', name: '导轨', spec: 'TH35-7.5 DIN导轨', unit: '米', supplier: '上海电器', lead: 7 },
  ]

  const insertContract = d.prepare(`INSERT INTO biz_contracts (id, contract_no, customer, sign_date, status, amount) VALUES (?,?,?,?,?,?)`)
  const insertDevice = d.prepare(`INSERT INTO biz_devices (id, contract_id, device_name, device_code, quantity, planned_start, planned_finish) VALUES (?,?,?,?,?,?,?)`)
  const insertPackage = d.prepare(`INSERT INTO biz_packages (id, device_id, package_name, package_code, planned_production, quantity, status) VALUES (?,?,?,?,?,?,?)`)
  const insertMaterial = d.prepare(`INSERT INTO biz_materials (id, package_id, material_code, material_name, spec, unit, required_qty, current_stock, in_transit, shortage_qty, supplier, lead_time_days, kit_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insertBalance = d.prepare(`INSERT INTO biz_material_daily_balance (id, material_id, date, supply_qty, demand_qty, balance, cumulative_balance, note) VALUES (?,?,?,?,?,?,?,?)`)

  let matSeq = 0
  let balSeq = 0

  const transaction = d.transaction(() => {
    for (const c of contracts) {
      insertContract.run(c.id, c.no, c.cust, c.sign, c.status, c.amt)

      // 2-4 devices per contract
      const deviceCount = 2 + Math.floor(Math.random() * 3)
      const shuffledDevices = [...deviceTypes].sort(() => Math.random() - 0.5)
      for (let di = 0; di < deviceCount; di++) {
        const dt = shuffledDevices[di]
        const devId = `DEV-${String(di + 1).padStart(3, '0')}-${c.id}`
        const plannedStart = new Date(2025, 4 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 28))
        const plannedFinish = new Date(plannedStart.getTime() + (30 + Math.floor(Math.random() * 60)) * 86400000)
        insertDevice.run(devId, c.id, dt.name, `${dt.code}-${di+1}`, 1, fmt(plannedStart), fmt(plannedFinish))

        // 2-5 packages per device
        const pkgCount = 2 + Math.floor(Math.random() * 4)
        const shuffledPkgs = [...packageTypes].sort(() => Math.random() - 0.5)
        for (let pi = 0; pi < pkgCount; pi++) {
          const pt = shuffledPkgs[pi]
          const pkgId = `PKG-${String(di + 1).padStart(2, '0')}${String(pi + 1).padStart(2, '0')}-${c.id}`
          // Planned production date: 30-90 days from now (some in past, some in future)
          const prodDateOffset = -15 + Math.floor(Math.random() * 105)
          const plannedProd = new Date(now.getTime() + prodDateOffset * 86400000)
          insertPackage.run(pkgId, devId, pt.name, `${pt.code}-${di+1}${pi+1}`, fmtISO(plannedProd), 1, '待生产')

          // 5-15 materials per package
          const matCount = 5 + Math.floor(Math.random() * 11)
          const shuffledMats = [...materialPool].sort(() => Math.random() - 0.5)
          for (let mi = 0; mi < matCount && mi < shuffledMats.length; mi++) {
            const mt = shuffledMats[mi]
            matSeq++
            const matId = `MAT-${String(matSeq).padStart(4, '0')}`
            const requiredQty = Math.round((5 + Math.random() * 95)) // 5-100
            // ~30% chance of shortage
            const shortageRoll = Math.random()
            let currentStock: number, inTransit: number
            if (shortageRoll < 0.15) {
              // Severe shortage: stock < 50%
              currentStock = Math.round(requiredQty * (0.1 + Math.random() * 0.4))
              inTransit = Math.round(requiredQty * (0.05 + Math.random() * 0.15))
            } else if (shortageRoll < 0.35) {
              // Partial shortage: stock 50-90%
              currentStock = Math.round(requiredQty * (0.3 + Math.random() * 0.5))
              inTransit = Math.round(requiredQty * (0.05 + Math.random() * 0.2))
            } else {
              // Adequate
              currentStock = Math.round(requiredQty * (0.6 + Math.random() * 0.8))
              inTransit = Math.round(requiredQty * (0.1 + Math.random() * 0.4))
            }
            const totalAvail = currentStock + inTransit
            const shortageQty = Math.max(0, requiredQty - totalAvail)
            let kitStatus = '已齐套'
            if (totalAvail < requiredQty * 0.5) kitStatus = '未齐套'
            else if (totalAvail < requiredQty) kitStatus = '部分齐套'

            insertMaterial.run(matId, pkgId, mt.code, mt.name, mt.spec, mt.unit, requiredQty, currentStock, inTransit, shortageQty, mt.supplier, mt.lead, kitStatus)

            // Generate daily balance from today to planned production date
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const endDate = new Date(Math.max(plannedProd.getTime(), today.getTime() + 15 * 86400000))
            let cumulativeBalance = currentStock
            for (let d = new Date(today); d <= endDate; d.setDate(d.getDate() + 1)) {
              balSeq++
              const daySupply = Math.random() < 0.15 ? Math.round(requiredQty * (0.05 + Math.random() * 0.15)) : 0
              const dayDemand = Math.random() < 0.2 ? Math.round(requiredQty * (0.03 + Math.random() * 0.12)) : 0
              cumulativeBalance = cumulativeBalance + daySupply - dayDemand
              const dayBalance = daySupply - dayDemand
              let note = ''
              if (daySupply > 0) note = `到货 ${daySupply}${mt.unit}`
              if (dayDemand > 0) note = note ? `${note}；消耗 ${dayDemand}${mt.unit}` : `消耗 ${dayDemand}${mt.unit}`
              insertBalance.run(`BAL-${String(balSeq).padStart(6, '0')}`, matId, fmtISO(d), daySupply, dayDemand, dayBalance, cumulativeBalance, note)
            }
          }
        }
      }
    }
  })

  transaction()
  console.log(`[DB] Seeded biz data: ${contracts.length} contracts, ${matSeq} materials, ${balSeq} daily balances`)
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
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_call_id TEXT DEFAULT '',
      tool_calls_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

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

    CREATE TABLE IF NOT EXISTS biz_contracts (
      id TEXT PRIMARY KEY,
      contract_no TEXT NOT NULL,
      customer TEXT NOT NULL,
      sign_date TEXT DEFAULT '',
      status TEXT DEFAULT '执行中',
      amount REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS biz_devices (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES biz_contracts(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      device_code TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      planned_start TEXT DEFAULT '',
      planned_finish TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS biz_packages (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES biz_devices(id) ON DELETE CASCADE,
      package_name TEXT NOT NULL,
      package_code TEXT DEFAULT '',
      planned_production TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT '待生产',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS biz_materials (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL REFERENCES biz_packages(id) ON DELETE CASCADE,
      material_code TEXT NOT NULL,
      material_name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      unit TEXT DEFAULT '个',
      required_qty REAL DEFAULT 0,
      current_stock REAL DEFAULT 0,
      in_transit REAL DEFAULT 0,
      shortage_qty REAL DEFAULT 0,
      supplier TEXT DEFAULT '',
      lead_time_days INTEGER DEFAULT 0,
      kit_status TEXT DEFAULT '待检查',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS biz_material_daily_balance (
      id TEXT PRIMARY KEY,
      material_id TEXT NOT NULL REFERENCES biz_materials(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      supply_qty REAL DEFAULT 0,
      demand_qty REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      cumulative_balance REAL DEFAULT 0,
      note TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_balance_mat_date ON biz_material_daily_balance(material_id, date);
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

  // Parse a2ui_data if present
  let a2uiData: unknown[] | null = null
  if (task.a2ui_data) {
    try { a2uiData = JSON.parse(task.a2ui_data) } catch { a2uiData = null }
  }

  const result: any = {
    ...task,
    a2uiData,
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

export function saveA2uiData(taskId: string, a2uiMessages: unknown[]): boolean {
  const d = getDb()
  try {
    d.prepare('UPDATE analysis_tasks SET a2ui_data = ? WHERE id = ?').run(JSON.stringify(a2uiMessages), taskId)
    return true
  } catch (err) {
    console.error('[DB] saveA2uiData error:', err)
    return false
  }
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

interface ChatMessageRow {
  id: number; role: string; content: string; tool_call_id: string; tool_calls_json: string; created_at: string
}

export function getChatMessages(sessionId: string): ChatMessageRow[] {
  const d = getDb()
  return d.prepare(
    'SELECT id, role, content, tool_call_id, tool_calls_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId) as any[]
}

export function saveChatMessage(
  sessionId: string,
  role: string,
  content: string,
  toolCallId?: string,
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>,
) {
  const d = getDb()
  createChatSession(sessionId)
  d.prepare(
    'INSERT INTO chat_messages (session_id, role, content, tool_call_id, tool_calls_json) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, role, content, toolCallId || '', toolCalls ? JSON.stringify(toolCalls) : '[]')
  if (role === 'user') {
    const row = d.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(sessionId) as any
    if (row && !row.title) {
      const title = content.slice(0, 30).replace(/\n/g, ' ')
      updateSessionTitle(sessionId, title)
    }
  }
  touchChatSession(sessionId)
}

interface SaveMessage {
  role: string
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
}

export function saveChatMessages(sessionId: string, messages: SaveMessage[]) {
  const d = getDb()
  createChatSession(sessionId)
  // Only insert messages that don't already exist (by session + role + content + tool_call_id)
  // This preserves messages saved individually (e.g. user messages from frontend) that may
  // have been compacted from the in-memory session before the batch save runs.
  const checkSql = `SELECT COUNT(*) as c FROM chat_messages
    WHERE session_id = ? AND role = ? AND content = ? AND tool_call_id = ?`
  const check = d.prepare(checkSql)
  const insert = d.prepare(
    'INSERT INTO chat_messages (session_id, role, content, tool_call_id, tool_calls_json) VALUES (?, ?, ?, ?, ?)'
  )
  let inserted = 0
  const transaction = d.transaction(() => {
    for (const msg of messages) {
      const tcId = (msg as any).toolCallId || ''
      const row = check.get(sessionId, msg.role, msg.content, tcId) as any
      if (row && row.c > 0) continue // already saved
      insert.run(
        sessionId,
        msg.role,
        msg.content,
        tcId,
        (msg as any).toolCalls ? JSON.stringify((msg as any).toolCalls) : '[]',
      )
      inserted++
    }
  })
  transaction()
  const firstUser = messages.find(m => m.role === 'user')
  if (firstUser) {
    const row = d.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(sessionId) as any
    if (row && !row.title) {
      updateSessionTitle(sessionId, firstUser.content.slice(0, 30).replace(/\n/g, ' '))
    }
  }
  touchChatSession(sessionId)
  return { success: true, count: inserted }
}

// ── Session helpers ──

export function createChatSession(sessionId: string): void {
  const d = getDb()
  d.prepare(
    'INSERT OR IGNORE INTO chat_sessions (id) VALUES (?)'
  ).run(sessionId)
}

export function getChatSessions(): Array<{ id: string; title: string; created_at: string; updated_at: string }> {
  const d = getDb()
  return d.prepare(
    'SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC'
  ).all() as any[]
}

export function updateSessionTitle(sessionId: string, title: string): void {
  const d = getDb()
  d.prepare(
    "UPDATE chat_sessions SET title = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(title, sessionId)
}

// Also update session timestamp when a message is saved
function touchChatSession(sessionId: string): void {
  const d = getDb()
  d.prepare(
    "UPDATE chat_sessions SET updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(sessionId)
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
