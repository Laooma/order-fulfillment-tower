// Run: npx tsx src/services/seed.ts
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'analysis.db')
const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Create schema
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
`)

// Seed data
const taskId = 'T20260518101'

db.prepare(`INSERT OR REPLACE INTO analysis_tasks (id, title, description, agent, initiator, status, created_at, completed_at)
  VALUES (?, ?, ?, ?, 'Hi·金星米', 'todos_generated', '2026/5/18 10:30:00', '2026/5/18 10:32:00')`)
  .run(taskId, 'SCJD20241114-K01 履约分析报告', '分析订单SCJD20241114-K01的履约状态，识别卡点与风险', '订单履约专家')

const orderId = `${taskId}_SCJD20241114-K01`
db.prepare(`INSERT OR REPLACE INTO analysis_orders (id, analysis_task_id, contract_number, customer, amount, shipment_ratio, status, status_class, sales, region, order_date)
  VALUES (?, ?, 'SCJD20241114-K01', '中国铁制股份有限公司', '1,558.00', 65, '待发货', 'blue', '李明', '华北大区 / 安徽', '2024/11/14')`)
  .run(orderId, taskId)

const categories = [
  { name: '问题类型1-未接发货', type: 1, problems: [
    { mc: 'CCU-2000', mn: '控制系统', pn: '断路器控制板', pnum: 'HT001241', tags: JSON.stringify([{label:'待处理',variant:'pill'},{label:'紧急',variant:'urgent'}]) },
    { mc: 'SCU-1500', mn: '变频器单元', pn: '逆变模块', pnum: 'HT002402', tags: JSON.stringify([{label:'待处理',variant:'pill'}]) },
    { mc: 'MCU-800', mn: '主控单元', pn: '电源管理板', pnum: 'HT001503', tags: JSON.stringify([{label:'待处理',variant:'pill'}]) },
    { mc: 'DCU-300', mn: '驱动控制', pn: '编码器接口', pnum: 'HT002104', tags: JSON.stringify([{label:'待处理',variant:'pill'},{label:'常规',variant:'normal'}]) },
    { mc: 'IOU-120', mn: '输入输出模块', pn: '继电器板', pnum: 'HT001805', tags: JSON.stringify([{label:'待处理',variant:'pill'}]) },
    { mc: 'PSU-500', mn: '电源单元', pn: '整流模块', pnum: 'HT002306', tags: JSON.stringify([{label:'待处理',variant:'pill'}]) },
  ]},
  { name: '问题类型2-入库登记', type: 2, problems: [
    { mc: 'CCU-2000', mn: '控制系统', pn: '断路器控制板', pnum: 'HT001241', tags: JSON.stringify([{label:'待入库',variant:'pill'}]) },
    { mc: 'SCU-1500', mn: '变频器单元', pn: '逆变模块', pnum: 'HT002402', tags: JSON.stringify([{label:'待入库',variant:'pill'},{label:'加急',variant:'urgent'}]) },
    { mc: 'MCU-800', mn: '主控单元', pn: '电源管理板', pnum: 'HT001503', tags: JSON.stringify([{label:'待入库',variant:'pill'}]) },
  ]},
  { name: '问题类型3-发货方式存在问题', type: 3, problems: [
    { mc: 'CCU-2000', mn: '控制系统', pn: '断路器控制板', pnum: 'HT001241', tags: JSON.stringify([{label:'待确认',variant:'pill'}]) },
    { mc: 'SCU-1500', mn: '变频器单元', pn: '逆变模块', pnum: 'HT002402', tags: JSON.stringify([{label:'待确认',variant:'pill'}]) },
    { mc: 'MCU-800', mn: '主控单元', pn: '电源管理板', pnum: 'HT001503', tags: JSON.stringify([{label:'待确认',variant:'pill'}]) },
    { mc: 'DCU-300', mn: '驱动控制', pn: '编码器接口', pnum: 'HT002104', tags: JSON.stringify([{label:'待确认',variant:'pill'}]) },
    { mc: 'IOU-120', mn: '输入输出模块', pn: '继电器板', pnum: 'HT001805', tags: JSON.stringify([{label:'待确认',variant:'pill'},{label:'需协调',variant:'urgent'}]) },
    { mc: 'PSU-500', mn: '电源单元', pn: '整流模块', pnum: 'HT002306', tags: JSON.stringify([{label:'待确认',variant:'pill'}]) },
  ]},
  { name: '问题类型4-未知问题', type: 4, problems: [
    { mc: 'CCU-2000', mn: '控制系统', pn: '断路器控制板', pnum: 'HT001241', tags: JSON.stringify([{label:'待排查',variant:'pill'}]) },
    { mc: 'SCU-1500', mn: '变频器单元', pn: '逆变模块', pnum: 'HT002402', tags: JSON.stringify([{label:'待排查',variant:'pill'}]) },
    { mc: 'MCU-800', mn: '主控单元', pn: '电源管理板', pnum: 'HT001503', tags: JSON.stringify([{label:'待排查',variant:'pill'}]) },
    { mc: 'DCU-300', mn: '驱动控制', pn: '编码器接口', pnum: 'HT002104', tags: JSON.stringify([{label:'待排查',variant:'pill'}]) },
  ]},
]

categories.forEach((cat, ci) => {
  const catId = `${orderId}_cat_${ci}`
  db.prepare('INSERT OR REPLACE INTO analysis_problem_categories (id, order_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(catId, orderId, cat.name, cat.type, ci)
  cat.problems.forEach((p, pi) => {
    const probId = `${catId}_prob_${pi}`
    db.prepare('INSERT OR REPLACE INTO analysis_problems (id, category_id, material_code, material_name, part_name, part_number, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(probId, catId, p.mc, p.mn, p.pn, p.pnum, p.tags, '待处理')

    // Seed card detail for first problem of each category
    if (pi === 0) {
      const materialInfo = JSON.stringify({
        '需求属性': p.mn,
        '需求类别': '产品型',
        '品牌': p.mc,
        '需求系列描述': p.pn,
        '需求定制产品': '定制',
        '发货方式': '直发客户',
      })
      const aiAnalysis = `${p.mc} ${p.mn} · ${p.pn}（编号：${p.pnum}）当前处于「${cat.name}」环节。该物料发货进度存在延迟风险，主要原因包括：1）供应商原材料采购周期超出预期；2）中间仓库存调拨未及时确认；3）物流承运商运力紧张。建议优先协调供应商加急供货，并同步通知客户可能的延期情况。`
      const deliveryPath = JSON.stringify([
        { docType: '销售合同订单', docNo: 'SO_20240001', badge: 'BPM', qty: 100, status: '生效', problemPoint: '合同约定数量100，后续单据存在偏差' },
        { docType: '发货申请单', docNo: 'SA_20240001', badge: 'BPM', qty: 100, status: '审核中', problemPoint: '审核流程卡在财务确认环节，预计延迟2天' },
        { docType: '销售出库单', docNo: 'DN_20240001', badge: 'SAP', qty: 80, status: '已过账', problemPoint: '实发数量80，较合同短少20，需核实原因' },
      ])
      db.prepare('INSERT OR REPLACE INTO analysis_card_details (id, problem_id, material_info_json, ai_analysis, delivery_path_json) VALUES (?, ?, ?, ?, ?)')
        .run(`${probId}_detail`, probId, materialInfo, aiAnalysis, deliveryPath)
    }
  })
})

// Todos
const todos = [
  { cat:'发货任务', desc:'CCU-2000 控制系统断路器控制板发货确认', prio:'high', assignee:'李明', supervisor:'张伟', due:'2024-11-18', status:'pending', type:'agent' },
  { cat:'发货任务', desc:'SCU-1500 变频器单元逆变模块出库核对', prio:'medium', assignee:'张伟', supervisor:'李明', due:'2024-11-20', status:'progress', type:'agent' },
  { cat:'发货任务', desc:'MCU-800 主控单元电源管理板物流安排', prio:'medium', assignee:'王芳', supervisor:'李明', due:'2024-11-19', status:'pending', type:'agent' },
  { cat:'发货任务', desc:'DCU-300 驱动控制编码器接口发货方式确认', prio:'low', assignee:'刘洋', supervisor:'李明', due:'2024-11-22', status:'pending', type:'decision' },
  { cat:'入库任务', desc:'CCU-2000 控制系统入库登记与质检', prio:'medium', assignee:'赵强', supervisor:'李明', due:'2024-11-19', status:'pending', type:'manual' },
  { cat:'入库任务', desc:'SCU-1500 变频器单元加急入库确认', prio:'high', assignee:'孙丽', supervisor:'李明', due:'2024-11-16', status:'overdue', type:'manual' },
  { cat:'合同确认', desc:'SCJD20241114-K01 合同发货条款二次确认', prio:'high', assignee:'李明', supervisor:'张伟', due:'2024-11-17', status:'overdue', type:'decision' },
  { cat:'异常处理', desc:'CCU-2000 控制系统断路器控制板质量问题排查', prio:'high', assignee:'赵强', supervisor:'李明', due:'2024-11-16', status:'overdue', type:'agent' },
]
todos.forEach((t, ti) => {
  db.prepare('INSERT OR REPLACE INTO analysis_todos (id, order_id, category, description, priority, assignee, supervisor, due_date, status, task_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(`${orderId}_todo_${ti}`, orderId, t.cat, t.desc, t.prio, t.assignee, t.supervisor, t.due, t.status, t.type)
})

// Delivery tables
const dts = [
  { title:'销售合同订单', badge:'BPM', items: JSON.stringify([{docNo:'SO_20240001',status:'生效',lineNo:'10',sign:'蓝字',qty:100},{docNo:'SO_20240002',status:'生效',lineNo:'01',sign:'蓝字',qty:50}]) },
  { title:'发货申请单', badge:'BPM', items: JSON.stringify([{docNo:'SA_20240001',status:'审核中',lineNo:'10',sign:'蓝字',qty:100}]) },
  { title:'销售出库单', badge:'SAP', items: JSON.stringify([{docNo:'DN_20240001',status:'已过账',lineNo:'10',sign:'蓝字',qty:80},{docNo:'DN_20240002',status:'待过账',lineNo:'20',sign:'蓝字',qty:20}]) },
]
dts.forEach((dt, dti) => {
  db.prepare('INSERT OR REPLACE INTO analysis_delivery_tables (id, order_id, title, badge, items_json) VALUES (?, ?, ?, ?, ?)')
    .run(`${orderId}_dt_${dti}`, orderId, dt.title, dt.badge, dt.items)
})

console.log('Seed complete! Test analysis task created:', taskId)
console.log(`Database at: ${DB_PATH}`)
db.close()
