// Run: npx tsx src/services/seed-shipment.ts
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'analysis.db')
const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Create schema (idempotent)
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

// Clear existing seed data for this task
const taskId = 'T20260519101'
db.prepare('DELETE FROM analysis_todos WHERE order_id LIKE ?').run(`${taskId}%`)
db.prepare('DELETE FROM analysis_card_details WHERE problem_id LIKE ?').run(`${taskId}%`)
db.prepare('DELETE FROM analysis_problems WHERE category_id LIKE ?').run(`${taskId}%`)
db.prepare('DELETE FROM analysis_problem_categories WHERE order_id LIKE ?').run(`${taskId}%`)
db.prepare('DELETE FROM analysis_delivery_tables WHERE order_id LIKE ?').run(`${taskId}%`)
db.prepare('DELETE FROM analysis_orders WHERE analysis_task_id = ?').run(taskId)
db.prepare('DELETE FROM analysis_tasks WHERE id = ?').run(taskId)

// Insert analysis task
db.prepare(`INSERT INTO analysis_tasks (id, title, description, agent, initiator, status, created_at, completed_at)
  VALUES (?, ?, ?, ?, '金星米', 'todos_generated', '2026/5/19 09:00:00', '2026/5/19 09:15:00')`)
  .run(taskId, '技术公司项目物资发货跟进-20260506', '分析全部113个合同的物资发货状态，识别未出库物资及其卡点，生成跟进待办事项', '订单履约专家')

// ---- Order data from CSV ----
interface CsvRow {
  contractNo: string
  customer: string
  project: string
  amount: string
  paymentRatio: string
  orderQty: string
  undeliveredQty: string
  undeliveredAmount: string
  shipmentRatio: string
  notes: string
}

const rawData: CsvRow[] = [
  { contractNo:'SCJSD20220628-K004', customer:'中核控制系统工程有限公司', project:'示范快堆工程2号机组非安全级DCS设备采购【LOT2B1】', amount:'9,783,154.00', paymentRatio:'28.39', orderQty:'6,878.00', undeliveredQty:'35.00', undeliveredAmount:'374,751.99', shipmentRatio:'96.17%', notes:'' },
  { contractNo:'SCJSO20231008-WE01', customer:'CHINA PETROLEUM PIPELINE ENGINEERING CO. LTD', project:'Trile UV IR Detector For (EPC) for New Nassiriya Depot Project, Iraq', amount:'6,266,681.25', paymentRatio:'24.43', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'151,726.47', shipmentRatio:'82.27%', notes:'' },
  { contractNo:'SCJSD20251111-K02', customer:'河南金海新材料股份有限公司', project:'金海氟硅新材料项目 全厂控制系统与软件(AAS\\APC\\OT\\VxDirect)', amount:'5,630,000.00', paymentRatio:'100.00', orderQty:'84.00', undeliveredQty:'18.00', undeliveredAmount:'19,739.55', shipmentRatio:'99.65%', notes:'' },
  { contractNo:'SCJSD20251217-SCGLB02', customer:'苏州工业园区胜福科技有限公司', project:'胜福20251123ZM', amount:'5,346,628.60', paymentRatio:'0.27', orderQty:'1,930,920.00', undeliveredQty:'123,000.00', undeliveredAmount:'18,450.29', shipmentRatio:'99.65%', notes:'' },
  { contractNo:'SCJSD20240326-WE03', customer:'北京天时盈达自动化设备有限公司', project:'产品型销售合同_20240319_005', amount:'4,641,996.95', paymentRatio:'100.00', orderQty:'61,076.00', undeliveredQty:'60,721.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20240409-EPC03', customer:'中铁二十一局集团第四工程有限公司', project:'中铁21局四公司广西平果市智慧、部门项目电缆及监控', amount:'4,641,629.80', paymentRatio:'81.34', orderQty:'15,155.30', undeliveredQty:'3,622.00', undeliveredAmount:'866,417.13', shipmentRatio:'81.33%', notes:'' },
  { contractNo:'SCJSD20250930-Z03', customer:'内蒙古汇能煤化工有限公司', project:'APC&RTO自动化控制系统采购合同', amount:'4,580,000.00', paymentRatio:'0', orderQty:'52.00', undeliveredQty:'35.00', undeliveredAmount:'795,326.11', shipmentRatio:'82.63%', notes:'' },
  { contractNo:'SCJSD20240627-WE01', customer:'北京天时盈达自动化设备有限公司', project:'罗克韦尔卡件一批 4320263.14元', amount:'4,320,263.14', paymentRatio:'59.33', orderQty:'345,765.14', undeliveredQty:'345,529.14', undeliveredAmount:'862,805.06', shipmentRatio:'80.03%', notes:'' },
  { contractNo:'SCJSD20250328-PLC04', customer:'中控风能控制技术（北京）有限公司', project:'200套风机主控备货', amount:'3,213,468.00', paymentRatio:'39.61', orderQty:'6,993.00', undeliveredQty:'129.00', undeliveredAmount:'46,093.42', shipmentRatio:'98.57%', notes:'' },
  { contractNo:'SCJSD20250228-407', customer:'江苏百科建筑工程有限公司园区分公司', project:'江苏诺泰澳赛诺生物制药股份有限公司706车间仪表、阀门采购', amount:'2,967,207.00', paymentRatio:'60.24', orderQty:'1,045.00', undeliveredQty:'1.00', undeliveredAmount:'13,170.25', shipmentRatio:'99.56%', notes:'' },
  { contractNo:'SCJSD20241231-SCGLB06', customer:'上能电气股份有限公司', project:'上能1209', amount:'2,269,157.00', paymentRatio:'59.29', orderQty:'253.00', undeliveredQty:'45.00', undeliveredAmount:'403,605.02', shipmentRatio:'82.21%', notes:'' },
  { contractNo:'SCJSD20250411-SCGLB05', customer:'苏州工业园区胜福科技有限公司', project:'胜福250410', amount:'2,029,161.28', paymentRatio:'100.00', orderQty:'265,426.00', undeliveredQty:'800.00', undeliveredAmount:'682.30', shipmentRatio:'99.97%', notes:'' },
  { contractNo:'SCJSO20250630-LA01', customer:'HQC Engineering Malaysia Sdn. Bhd.', project:'产品型销售合同_20250630_001', amount:'1,977,491.41', paymentRatio:'51.17', orderQty:'139.00', undeliveredQty:'8.00', undeliveredAmount:'1,973.67', shipmentRatio:'99.28%', notes:'' },
  { contractNo:'SCJSD20250930-606', customer:'中兴正远信息技术（天津）有限公司', project:'卤水一厂黑灯工厂项目', amount:'1,300,000.00', paymentRatio:'0', orderQty:'24.00', undeliveredQty:'2.00', undeliveredAmount:'0.02', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20260131-67301', customer:'中海油天津化工研究设计院有限公司', project:'天化院数据中心采购项目', amount:'1,276,611.89', paymentRatio:'0', orderQty:'28.00', undeliveredQty:'18.00', undeliveredAmount:'166,813.45', shipmentRatio:'86.93%', notes:'' },
  { contractNo:'SCJSD20240929-FZ02', customer:'江西九江国泰新材料有限公司', project:'自动控制系统及信息化管理系统采购及安装——001项目（订阅制）', amount:'981,200.00', paymentRatio:'60.00', orderQty:'75.00', undeliveredQty:'5.00', undeliveredAmount:'140,000.00', shipmentRatio:'83.89%', notes:'' },
  { contractNo:'SCJSD20260310-K01', customer:'新乡市瑞丰新材料股份有限公司', project:'T512车间阀门采购', amount:'978,758.00', paymentRatio:'56.70', orderQty:'204.00', undeliveredQty:'8.00', undeliveredAmount:'54,499.77', shipmentRatio:'94.43%', notes:'' },
  { contractNo:'SCJSD20231202-SCGLB01', customer:'上能电气股份有限公司', project:'上能电气20231130', amount:'941,379.00', paymentRatio:'86.66', orderQty:'116.00', undeliveredQty:'20.00', undeliveredAmount:'180,269.70', shipmentRatio:'80.85%', notes:'' },
  { contractNo:'SCJSD20250709-XB01', customer:'兰州森洋隆泰化学有限公司', project:'年产2000吨催化剂及副产建设项目（一期）', amount:'661,771.00', paymentRatio:'59.28', orderQty:'94.00', undeliveredQty:'1.00', undeliveredAmount:'7,416.50', shipmentRatio:'98.88%', notes:'' },
  { contractNo:'SCJSD20241031-SCGLB02', customer:'杭州高特新能源有限公司', project:'高特新能源1028', amount:'650,645.00', paymentRatio:'100.00', orderQty:'50.00', undeliveredQty:'1.00', undeliveredAmount:'17,191.52', shipmentRatio:'97.36%', notes:'' },
  { contractNo:'SCJSD20260306-K01', customer:'河南金渠钼业有限公司', project:'仪表采购', amount:'612,258.00', paymentRatio:'59.29', orderQty:'282.00', undeliveredQty:'10.00', undeliveredAmount:'65,719.54', shipmentRatio:'89.27%', notes:'' },
  { contractNo:'SCJSO20250530-JAPAN02', customer:'三菱化学（中国）管理有限公司', project:'三菱化学Plantbot Studio软件订阅产品合同', amount:'600,000.00', paymentRatio:'20.00', orderQty:'6.00', undeliveredQty:'1.00', undeliveredAmount:'3,479.70', shipmentRatio:'99.42%', notes:'' },
  { contractNo:'SCJSD20240704-SCGLB02', customer:'上能电气股份有限公司', project:'上能0709', amount:'572,960.00', paymentRatio:'100.00', orderQty:'82.00', undeliveredQty:'1.00', undeliveredAmount:'7,105.05', shipmentRatio:'98.76%', notes:'' },
  { contractNo:'SCJSD20230630-WE02', customer:'重庆威尔德科技有限公司', project:'2023-2024年浙江中控控制系统配件采购框架协议', amount:'558,720.00', paymentRatio:'70.47', orderQty:'360.00', undeliveredQty:'72.00', undeliveredAmount:'27,936.00', shipmentRatio:'95.00%', notes:'' },
  { contractNo:'SCJSD20251212-J05', customer:'淄博天元化工有限公司', project:'醋酸酯合成连续生产装置仪表', amount:'538,100.00', paymentRatio:'58.45', orderQty:'245.00', undeliveredQty:'2.00', undeliveredAmount:'11,668.62', shipmentRatio:'97.83%', notes:'' },
  { contractNo:'SCJSD20200716-704', customer:'吉林化学工业进出口有限公司', project:'吉林石化进口分析仪表备件0243', amount:'493,900.00', paymentRatio:'0', orderQty:'201.00', undeliveredQty:'20.00', undeliveredAmount:'6,901.02', shipmentRatio:'98.60%', notes:'' },
  { contractNo:'SCJSD20241129-PLC04', customer:'浙江中控信息产业股份有限公司', project:'湖南株洲项目群丰、枫溪污水处理厂电气自控仪表设备采购', amount:'475,000.00', paymentRatio:'100.00', orderQty:'423.00', undeliveredQty:'2.00', undeliveredAmount:'9,819.97', shipmentRatio:'97.93%', notes:'' },
  { contractNo:'SCJSD20241202-PLC01', customer:'武汉晶美科技有限公司', project:'监控系统自主可控大型 PLC 适配研究（中控技术产品）竞争性谈判', amount:'467,360.00', paymentRatio:'100.00', orderQty:'655.00', undeliveredQty:'7.00', undeliveredAmount:'12,417.77', shipmentRatio:'97.34%', notes:'' },
  { contractNo:'SCJSD20241031-K006', customer:'核电秦山联营有限公司', project:'秦山核电中控DCS备件采购合同（秦二厂）', amount:'454,710.00', paymentRatio:'0', orderQty:'34.00', undeliveredQty:'2.00', undeliveredAmount:'19,654.14', shipmentRatio:'95.68%', notes:'' },
  { contractNo:'SCJSD20241104-SCGLB01', customer:'上能电气股份有限公司', project:'上能1101', amount:'441,798.00', paymentRatio:'100.00', orderQty:'101.00', undeliveredQty:'10.00', undeliveredAmount:'70,072.32', shipmentRatio:'84.14%', notes:'' },
  { contractNo:'SCJSD20241106-SCGLB01', customer:'杭州吉高智能电子科技有限公司', project:'吉高0910', amount:'412,980.00', paymentRatio:'100.00', orderQty:'8,384.00', undeliveredQty:'396.00', undeliveredAmount:'10,530.99', shipmentRatio:'97.45%', notes:'' },
  { contractNo:'SCJSD20230315-PLC02', customer:'浙江中控信息产业股份有限公司', project:'杭州地铁5号线一期工程和睦站、杭氧站、人民广场站、育才北路站物业区工程', amount:'394,668.00', paymentRatio:'95.19', orderQty:'648.00', undeliveredQty:'16.00', undeliveredAmount:'3,275.70', shipmentRatio:'99.17%', notes:'' },
  { contractNo:'SCJSD20251231-HB06', customer:'荆门盈德气体有限公司', project:'CCS备件', amount:'355,000.00', paymentRatio:'0', orderQty:'5.00', undeliveredQty:'1.00', undeliveredAmount:'28,318.65', shipmentRatio:'92.02%', notes:'' },
  { contractNo:'SCJSD20260202-602', customer:'河北伯雷斯自动化设备有限公司', project:'北京碧海能源装备有限公司ZNR300万方天然气处理项目', amount:'342,000.00', paymentRatio:'100.00', orderQty:'414.00', undeliveredQty:'4.00', undeliveredAmount:'2,848.38', shipmentRatio:'99.17%', notes:'' },
  { contractNo:'SCJSD20231226-SCGLB03', customer:'浙江可胜技术股份有限公司', project:'可胜项目121804', amount:'315,338.23', paymentRatio:'84.50', orderQty:'11,938.00', undeliveredQty:'35.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSO20241121-SFGATHER01', customer:'中信建设有限责任公司', project:'仪表', amount:'308,560.00', paymentRatio:'30.00', orderQty:'13.00', undeliveredQty:'1.00', undeliveredAmount:'11,262.71', shipmentRatio:'96.35%', notes:'' },
  { contractNo:'SCJSD20251231-DKHHD01-UC2', customer:'中国空分工程有限公司', project:'APC软件', amount:'300,000.00', paymentRatio:'13.67', orderQty:'5.00', undeliveredQty:'2.00', undeliveredAmount:'1,106.84', shipmentRatio:'99.63%', notes:'' },
  { contractNo:'SCJSO20250320-SFGATHER01', customer:'深圳凯盛科技工程有限公司', project:'【MY】Kibing Glass Sabah - 6MV Power Instrument', amount:'280,000.00', paymentRatio:'100.00', orderQty:'228.00', undeliveredQty:'1.00', undeliveredAmount:'5,724.80', shipmentRatio:'97.96%', notes:'' },
  { contractNo:'SCJSD20241105-67301', customer:'中国石化工程建设有限公司', project:'逻辑图智能设计软件', amount:'250,000.00', paymentRatio:'100.00', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20250807-PLC02', customer:'天津核安科技有限公司', project:'放药产线控制系统授权', amount:'230,000.00', paymentRatio:'20.00', orderQty:'22.00', undeliveredQty:'10.00', undeliveredAmount:'4,019.46', shipmentRatio:'98.25%', notes:'' },
  { contractNo:'SCJSO20230920-SUPCON EU01', customer:'亦苓集團有限公司', project:'Kas Paper Mill Spare Transmitters', amount:'222,057.00', paymentRatio:'100.00', orderQty:'29.00', undeliveredQty:'1.00', undeliveredAmount:'28,091.56', shipmentRatio:'87.35%', notes:'' },
  { contractNo:'SCJSD20250403-PLC03', customer:'浙江中控信息产业股份有限公司', project:'房县项目智慧水务调度中心、集控系统开发及工控系统升级改造设备采购合同', amount:'196,000.00', paymentRatio:'0', orderQty:'129.00', undeliveredQty:'1.00', undeliveredAmount:'2,878.32', shipmentRatio:'98.53%', notes:'' },
  { contractNo:'SCJSD20251117-602', customer:'郑州沃特节能科技股份有限公司', project:'产品型销售合同_20251114_013', amount:'180,750.00', paymentRatio:'100.00', orderQty:'28.00', undeliveredQty:'2.00', undeliveredAmount:'11,544.67', shipmentRatio:'93.61%', notes:'' },
  { contractNo:'SCJSD20231218-SCGLB01', customer:'上能电气股份有限公司', project:'上能项目1214', amount:'174,657.00', paymentRatio:'94.46', orderQty:'25.00', undeliveredQty:'1.00', undeliveredAmount:'9,816.01', shipmentRatio:'94.38%', notes:'' },
  { contractNo:'SCJSD20241112-SCGLB01', customer:'杭州吉高智能电子科技有限公司', project:'吉高1031', amount:'137,660.00', paymentRatio:'0', orderQty:'2,000.00', undeliveredQty:'24.00', undeliveredAmount:'1,651.92', shipmentRatio:'98.80%', notes:'' },
  { contractNo:'SCJSD20260127-1LH01', customer:'中国昆仑工程有限公司大连分公司', project:'广西石化新建化工罐区增补项目', amount:'131,683.17', paymentRatio:'0', orderQty:'49.00', undeliveredQty:'32.00', undeliveredAmount:'9,310.82', shipmentRatio:'92.93%', notes:'' },
  { contractNo:'SCJSD20220125-D03', customer:'湖南永杉锂业有限公司', project:'仪表采购合同', amount:'127,663.00', paymentRatio:'100.00', orderQty:'27.00', undeliveredQty:'2.00', undeliveredAmount:'2,517.42', shipmentRatio:'98.03%', notes:'' },
  { contractNo:'SCJSD20251105-PLC01', customer:'福建华拓自动化技术有限公司', project:'制冷设备控制PLC', amount:'123,486.00', paymentRatio:'100.00', orderQty:'130.00', undeliveredQty:'10.00', undeliveredAmount:'2,493.69', shipmentRatio:'97.98%', notes:'' },
  { contractNo:'SCJSD20250102-PLC03', customer:'合肥跃控智能科技有限公司', project:'广西南宁横州市六蓝灌区续建配套与现代化改造项目 5 标段信息化系统和设备采购服务', amount:'120,000.00', paymentRatio:'100.00', orderQty:'250.00', undeliveredQty:'6.00', undeliveredAmount:'1,862.75', shipmentRatio:'98.45%', notes:'' },
  { contractNo:'SCJSD20211213-FZ01', customer:'江西理文化工有限公司', project:'中控系统卡件', amount:'119,800.00', paymentRatio:'100.00', orderQty:'21.00', undeliveredQty:'2.00', undeliveredAmount:'2,932.90', shipmentRatio:'97.55%', notes:'' },
  { contractNo:'SCJSD20240808-ZW01', customer:'国家管网集团联合管道有限责任公司北方哈尔滨输油气分公司', project:'哈尔滨分公司2024年智能站场建设 （控制系统模块）的买卖合同', amount:'110,315.00', paymentRatio:'100.00', orderQty:'164,244.00', undeliveredQty:'82,114.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20241122-SCGLB02', customer:'上能电气股份有限公司', project:'上能1120', amount:'107,156.00', paymentRatio:'83.26', orderQty:'15.00', undeliveredQty:'2.00', undeliveredAmount:'17,845.09', shipmentRatio:'83.35%', notes:'' },
  { contractNo:'SCJSD20221107-DKHXB02', customer:'陕煤集团榆林化学有限责任公司', project:'化工主装置分散型控制系统（DCS）框架采购合同', amount:'99,100.00', paymentRatio:'100.09', orderQty:'80.00', undeliveredQty:'10.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20240907-PLC01', customer:'杭州锐行自动化科技有限公司', project:'合肥/南昌仓库改造项目', amount:'95,600.00', paymentRatio:'100.00', orderQty:'753.00', undeliveredQty:'6.00', undeliveredAmount:'2,312.05', shipmentRatio:'97.58%', notes:'' },
  { contractNo:'SCJSD20200605-GZ02', customer:'同宇新材料（广东）股份有限公司', project:'d202006022127482922_S2B_20200602_022', amount:'78,600.00', paymentRatio:'100.00', orderQty:'22.00', undeliveredQty:'4.00', undeliveredAmount:'10,281.25', shipmentRatio:'86.92%', notes:'' },
  { contractNo:'SCJSD20251016-HB02', customer:'湖北宜化精细化工有限公司', project:'备件采购', amount:'70,200.00', paymentRatio:'100.00', orderQty:'28.00', undeliveredQty:'4.00', undeliveredAmount:'765.35', shipmentRatio:'98.91%', notes:'' },
  { contractNo:'SCJSD20260306-GZ02', customer:'惠州市宙邦化工有限公司', project:'产品型销售合同_20260211_002', amount:'70,200.00', paymentRatio:'100.00', orderQty:'17.00', undeliveredQty:'2.00', undeliveredAmount:'9,255.65', shipmentRatio:'86.82%', notes:'' },
  { contractNo:'SCJSD20231226-SCGLB01', customer:'杭州吉高智能电子科技有限公司', project:'吉高合同20231225', amount:'68,038.60', paymentRatio:'100.00', orderQty:'1,120.00', undeliveredQty:'70.00', undeliveredAmount:'4,252.42', shipmentRatio:'93.75%', notes:'' },
  { contractNo:'SCJSD20201104-403', customer:'维讯化工（南京）有限公司', project:'产品型销售合同_20201102_019', amount:'61,200.00', paymentRatio:'100.00', orderQty:'12.00', undeliveredQty:'8.00', undeliveredAmount:'7,703.50', shipmentRatio:'87.41%', notes:'' },
  { contractNo:'SCJSD20240328-SCGLB02', customer:'杭州士腾科技有限公司', project:'士腾0327', amount:'59,706.97', paymentRatio:'100.00', orderQty:'7,273.00', undeliveredQty:'30.00', undeliveredAmount:'246.28', shipmentRatio:'99.59%', notes:'' },
  { contractNo:'SCJSD20260323-DKHHN01', customer:'江西天新药业股份有限公司', project:'20，22，43车间仪表', amount:'57,770.00', paymentRatio:'0', orderQty:'52.00', undeliveredQty:'12.00', undeliveredAmount:'10,848.49', shipmentRatio:'81.22%', notes:'' },
  { contractNo:'SCJSD20250814-J01', customer:'东明中油燃料石化有限公司', project:'中控物资采购2025.02.11', amount:'56,493.00', paymentRatio:'100.00', orderQty:'56.00', undeliveredQty:'1.00', undeliveredAmount:'2,009.22', shipmentRatio:'96.44%', notes:'' },
  { contractNo:'SCJSD20260421-Q03', customer:'安徽宇贝新材料科技有限公司', project:'备件采购', amount:'56,185.00', paymentRatio:'100.00', orderQty:'269.00', undeliveredQty:'101.00', undeliveredAmount:'5,851.68', shipmentRatio:'89.58%', notes:'' },
  { contractNo:'SCJSD20220414-403', customer:'南京诚志清洁能源有限公司', project:'OPC', amount:'55,000.00', paymentRatio:'100.00', orderQty:'4.00', undeliveredQty:'1.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20251118-N01', customer:'合肥多灵自动化设备有限公司', project:'备品备件', amount:'55,000.00', paymentRatio:'100.00', orderQty:'156.00', undeliveredQty:'50.00', undeliveredAmount:'699.86', shipmentRatio:'98.73%', notes:'' },
  { contractNo:'SCJSD20231207-PLC01', customer:'浙江源创智控技术有限公司', project:'青岛工业级PLC系统及仪表', amount:'53,768.00', paymentRatio:'48.28', orderQty:'6.00', undeliveredQty:'3.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20241223-DKHHD01', customer:'江苏优士化学有限公司', project:'新增操作员', amount:'53,319.00', paymentRatio:'100.00', orderQty:'27.00', undeliveredQty:'4.00', undeliveredAmount:'1,033.38', shipmentRatio:'98.06%', notes:'' },
  { contractNo:'SCJSD20241107-HB01', customer:'武汉汉口绿色能源有限公司', project:'模块采购', amount:'52,720.00', paymentRatio:'100.00', orderQty:'35.00', undeliveredQty:'11.00', undeliveredAmount:'9,442.63', shipmentRatio:'82.09%', notes:'' },
  { contractNo:'SCJSD20240415-PLC01', customer:'广东梓驰商贸有限公司', project:'中试实验装置', amount:'47,160.00', paymentRatio:'100.00', orderQty:'68.00', undeliveredQty:'4.00', undeliveredAmount:'65.47', shipmentRatio:'99.86%', notes:'' },
  { contractNo:'SCJSD20240807-ZW02', customer:'国家管网集团吉林天然气管道有限责任公司', project:'长春公司长长吉国产化改造项目软件狗采购项目', amount:'45,000.00', paymentRatio:'100.00', orderQty:'72,552.00', undeliveredQty:'42,093.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20260127-301', customer:'惠鲲国际贸易（上海）有限公司', project:'PS机柜门把手_20260125_001', amount:'42,000.00', paymentRatio:'100.00', orderQty:'211.00', undeliveredQty:'1.00', undeliveredAmount:'547.76', shipmentRatio:'98.70%', notes:'' },
  { contractNo:'SCJSD20251204-HN01', customer:'邵阳市云峰新能源科技有限公司', project:'产品型销售合同_20251123_003', amount:'41,290.00', paymentRatio:'90.00', orderQty:'16.00', undeliveredQty:'3.00', undeliveredAmount:'102.60', shipmentRatio:'99.75%', notes:'' },
  { contractNo:'SCJSD20260227-WF02', customer:'山东科源化工有限公司', project:'仪表阀门', amount:'40,006.00', paymentRatio:'0', orderQty:'18.00', undeliveredQty:'1.00', undeliveredAmount:'5,672.93', shipmentRatio:'85.82%', notes:'' },
  { contractNo:'SCJSD20240914-GZ02', customer:'广东理文造纸有限公司', project:'GDPO24080389采购备件', amount:'39,000.00', paymentRatio:'100.00', orderQty:'13.00', undeliveredQty:'1.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20250618-DKHHD02', customer:'浙江高晟能源新技术研究有限公司', project:'TSI', amount:'36,000.00', paymentRatio:'100.00', orderQty:'50.00', undeliveredQty:'2.00', undeliveredAmount:'4,000.00', shipmentRatio:'88.89%', notes:'' },
  { contractNo:'SCJSD20251118-Q01', customer:'中石化国际事业宁波有限公司', project:'安庆石化炼油一部重油催化裂解装置控制系统操作站升级', amount:'35,938.00', paymentRatio:'96.71', orderQty:'7.00', undeliveredQty:'1.00', undeliveredAmount:'0.72', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20211227-FZ01', customer:'江西邦浦医药化工有限公司', project:'新建103车间项目-现场仪表', amount:'35,000.00', paymentRatio:'100.00', orderQty:'27.00', undeliveredQty:'1.00', undeliveredAmount:'1,801.44', shipmentRatio:'94.85%', notes:'' },
  { contractNo:'SCJSD20230804-307', customer:'恒河材料科技股份有限公司', project:'恒河A区月度设备采购', amount:'32,960.00', paymentRatio:'86.69', orderQty:'25.00', undeliveredQty:'2.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20230119-Q01', customer:'安徽晋煤中能化工股份有限公司', project:'产品型销售合同_20230111_008', amount:'32,800.00', paymentRatio:'100.00', orderQty:'36.00', undeliveredQty:'8.00', undeliveredAmount:'1,988.10', shipmentRatio:'93.94%', notes:'' },
  { contractNo:'SCJSD20240312-HN01', customer:'湖南华菱涟源钢铁有限公司', project:'设材买卖合同', amount:'32,700.00', paymentRatio:'100.00', orderQty:'14.00', undeliveredQty:'3.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20240123-SCGLB01', customer:'杭州研智科技有限公司', project:'研智合同20240121', amount:'30,997.20', paymentRatio:'17.90', orderQty:'710.00', undeliveredQty:'1.00', undeliveredAmount:'43.66', shipmentRatio:'99.86%', notes:'' },
  { contractNo:'SCJSD20230803-K03', customer:'桐柏瑞鑫贸易有限公司', project:'备件一批', amount:'30,000.00', paymentRatio:'100.00', orderQty:'17.00', undeliveredQty:'1.00', undeliveredAmount:'696.27', shipmentRatio:'97.68%', notes:'' },
  { contractNo:'SCJSD20260409-PLC01', customer:'杭州锐行自动化科技有限公司', project:'辛烯催化剂放大研究项目', amount:'30,000.00', paymentRatio:'100.00', orderQty:'38.00', undeliveredQty:'8.00', undeliveredAmount:'1,245.24', shipmentRatio:'95.85%', notes:'' },
  { contractNo:'SCJSD20260402-PLC01', customer:'山东威飞哈船海洋科技有限公司', project:'陵水17-2气田10d11d井区开发项目增补3', amount:'24,000.00', paymentRatio:'0', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'363.18', shipmentRatio:'98.49%', notes:'' },
  { contractNo:'SCJSD20230414-313', customer:'卫星化学股份有限公司', project:'28个安全栅采购', amount:'21,840.00', paymentRatio:'100.00', orderQty:'84.00', undeliveredQty:'28.00', undeliveredAmount:'3,770.94', shipmentRatio:'82.73%', notes:'' },
  { contractNo:'SCJSD20230426-GZ02', customer:'深圳市邦时实业有限公司', project:'深圳邦时数据采集器项目', amount:'20,000.00', paymentRatio:'100.00', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20260313-PLC01', customer:'杭州达港电气有限公司', project:'(新海公司)自用工程建设大北处理站排水采气新增三相分离器', amount:'20,000.00', paymentRatio:'100.00', orderQty:'9.00', undeliveredQty:'1.00', undeliveredAmount:'163.91', shipmentRatio:'99.18%', notes:'' },
  { contractNo:'SCJSD20240604-PLC02', customer:'浙江源创智控技术有限公司', project:'软件开发软授权', amount:'19,000.00', paymentRatio:'0.48', orderQty:'3.00', undeliveredQty:'2.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20231115-J05', customer:'东明中油燃料石化有限公司', project:'采购订单-8000004563', amount:'18,136.00', paymentRatio:'100.00', orderQty:'16.00', undeliveredQty:'2.00', undeliveredAmount:'2,644.31', shipmentRatio:'85.42%', notes:'' },
  { contractNo:'SCJSD20251222-707', customer:'中冶焦耐自动化有限公司', project:'OPC软件', amount:'16,880.00', paymentRatio:'0', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'160.56', shipmentRatio:'99.05%', notes:'' },
  { contractNo:'SCJSD20260311-ZW01', customer:'国家管网集团北方管道有限责任公司石家庄输油气分公司', project:'2个G3编程软件（含软件授权）-石家庄公司', amount:'16,300.00', paymentRatio:'0', orderQty:'8,245.92', undeliveredQty:'8,241.92', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20250114-HB05', customer:'湖北云华安化工有限公司', project:'产品型销售合同_20250105_004', amount:'16,011.00', paymentRatio:'191.19', orderQty:'27.00', undeliveredQty:'3.00', undeliveredAmount:'1,357.05', shipmentRatio:'91.52%', notes:'' },
  { contractNo:'SCJSD20251120-FZ01', customer:'中化数智科技有限公司', project:'202511月备件采购', amount:'15,384.00', paymentRatio:'0', orderQty:'23.00', undeliveredQty:'10.00', undeliveredAmount:'377.29', shipmentRatio:'97.55%', notes:'' },
  { contractNo:'SCJSD20250619-HB02', customer:'无锡市利环环保设备有限公司', project:'产品型销售合同_20250613_001', amount:'14,500.00', paymentRatio:'100.00', orderQty:'15.00', undeliveredQty:'1.00', undeliveredAmount:'1,429.98', shipmentRatio:'90.14%', notes:'' },
  { contractNo:'SCJSD20201123-WF02', customer:'山东京博中聚新材料有限公司', project:'产品型销售合同_20201117_027', amount:'14,000.00', paymentRatio:'100.00', orderQty:'4.00', undeliveredQty:'2.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20240906-Q03', customer:'安徽华谊中控技术有限公司', project:'安徽华谊中控技术有限公司备件', amount:'14,000.00', paymentRatio:'100.00', orderQty:'20.00', undeliveredQty:'10.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20241210-PLC01', customer:'郑州蓝禾智能科技有限公司', project:'实验室建设PLC项目', amount:'13,800.00', paymentRatio:'100.00', orderQty:'19.00', undeliveredQty:'2.00', undeliveredAmount:'1,485.88', shipmentRatio:'89.23%', notes:'' },
  { contractNo:'SCJSD20251229-KM01', customer:'贵州省盘州市宏盛煤焦化有限公司', project:'备品配件', amount:'12,900.00', paymentRatio:'100.00', orderQty:'5.00', undeliveredQty:'1.00', undeliveredAmount:'356.24', shipmentRatio:'97.24%', notes:'' },
  { contractNo:'SCJSD20260121-DKHHN02', customer:'宁夏天新药业有限公司', project:'三甲酚车间温变及振动传感器', amount:'12,600.00', paymentRatio:'0', orderQty:'16.00', undeliveredQty:'2.00', undeliveredAmount:'1,739.57', shipmentRatio:'86.19%', notes:'' },
  { contractNo:'SCJSD20240924-PLC03', customer:'杭州达港电气有限公司', project:'卡件合同', amount:'12,100.00', paymentRatio:'100.00', orderQty:'38.00', undeliveredQty:'1.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20240313-PLC01', customer:'浙江国利信安科技有限公司', project:'SCADA增补', amount:'11,880.00', paymentRatio:'0', orderQty:'4.00', undeliveredQty:'2.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20260407-GZ01', customer:'武汉新康化工设备有限公司', project:'备件采购', amount:'11,350.00', paymentRatio:'100.00', orderQty:'7.00', undeliveredQty:'1.00', undeliveredAmount:'297.54', shipmentRatio:'97.38%', notes:'' },
  { contractNo:'SCJSD20231024-FZ02', customer:'福建永荣锦江股份有限公司', project:'仪表采购项目', amount:'9,800.00', paymentRatio:'100.00', orderQty:'4.00', undeliveredQty:'2.00', undeliveredAmount:'335.46', shipmentRatio:'96.58%', notes:'' },
  { contractNo:'SCJSD20220824-N01', customer:'阳煤集团太原化工新材料有限公司', project:'产品型销售合同_20220803_018', amount:'9,500.00', paymentRatio:'0', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20260416-MK01', customer:'天津德通电气有限公司', project:'选煤厂PLC组态软件', amount:'8,800.00', paymentRatio:'0', orderQty:'6.00', undeliveredQty:'4.00', undeliveredAmount:'325.52', shipmentRatio:'96.30%', notes:'' },
  { contractNo:'SCJSD20250113-GZ03', customer:'威格特（海南）科技有限公司', project:'海上平台项目', amount:'6,900.00', paymentRatio:'100.00', orderQty:'30.00', undeliveredQty:'2.00', undeliveredAmount:'460.00', shipmentRatio:'93.33%', notes:'' },
  { contractNo:'SCJSD20260302-403', customer:'江苏理文化工有限公司', project:'产品型销售合同_20260212_002', amount:'4,500.00', paymentRatio:'0', orderQty:'2.00', undeliveredQty:'1.00', undeliveredAmount:'542.87', shipmentRatio:'87.94%', notes:'' },
  { contractNo:'SCJSD20250801-801', customer:'成都英德生物医药装备技术有限公司', project:'无纸记录仪', amount:'4,000.00', paymentRatio:'100.00', orderQty:'4.00', undeliveredQty:'2.00', undeliveredAmount:'680.85', shipmentRatio:'82.98%', notes:'' },
  { contractNo:'SCJSD20260428-ZW02', customer:'国家管网集团北方管道有限责任公司长春输油气分公司', project:'长春公司连接模块采购-IM5002RJ', amount:'3,503.00', paymentRatio:'0', orderQty:'2,279.00', undeliveredQty:'2,278.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCJSD20240704-ZW02', customer:'国家管网集团联合管道有限责任公司西气东输分公司', project:'银川管理处模块采购合同', amount:'1,816.00', paymentRatio:'0', orderQty:'1,466.00', undeliveredQty:'1,465.00', undeliveredAmount:'0', shipmentRatio:'100.00%', notes:'' },
  { contractNo:'SCAQZND20240905-Q01_JS', customer:'安庆中控智能管家科技有限公司', project:'二期技改', amount:'1,367.05', paymentRatio:'100.00', orderQty:'12.00', undeliveredQty:'3.00', undeliveredAmount:'252.57', shipmentRatio:'81.52%', notes:'' },
  { contractNo:'SCTZGJD20250714-301_JS', customer:'中控智能管家科技（台州）有限公司', project:'7-9备件', amount:'1,016.62', paymentRatio:'0', orderQty:'6.00', undeliveredQty:'1.00', undeliveredAmount:'45.15', shipmentRatio:'95.56%', notes:'' },
]

// Region & sales assignment helpers
const salesPeople = ['李明', '张伟', '王芳', '刘洋', '赵强', '孙丽', '陈刚', '周敏']
const regions = ['华东大区 / 上海', '华东大区 / 江苏', '华东大区 / 浙江', '华北大区 / 北京', '华北大区 / 天津', '华南大区 / 广东', '华南大区 / 海南', '西北大区 / 陕西', '西北大区 / 甘肃', '西南大区 / 四川', '西南大区 / 重庆', '东北大区 / 辽宁', '东北大区 / 吉林', '华中大区 / 湖北', '华中大区 / 河南', '海外大区 / 中东', '海外大区 / 东南亚', '海外大区 / 东亚']

const getSales = (idx: number) => salesPeople[idx % salesPeople.length]
const getRegion = (idx: number) => regions[idx % regions.length]

// Generate dates from contract numbers
function getDateFromContract(no: string): string {
  // Try to extract date from contract number like SCJSD20220628-K004
  const m = no.match(/(\d{8})/)
  if (m) {
    const d = m[1]
    return `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`
  }
  return '2024/01/01'
}

// Determine status based on shipment ratio
function getStatusClass(ratio: number): string {
  if (ratio >= 99.5) return 'green'
  if (ratio >= 90) return 'blue'
  if (ratio >= 80) return 'yellow'
  return 'red'
}

function getStatus(ratio: number, undeliveredQty: number): string {
  if (ratio >= 99.5 && undeliveredQty <= 1) return '已完成'
  if (undeliveredQty > 100) return '严重滞后'
  if (undeliveredQty > 10) return '发货中'
  if (ratio >= 90) return '收尾阶段'
  if (ratio >= 80) return '发货中'
  return '待推进'
}

function parseNumber(val: string): number {
  const cleaned = val.replace(/,/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function parseRatio(val: string): number {
  const cleaned = val.replace(/%/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function parseShipmentRatio(val: string): number {
  const cleaned = val.replace(/%/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// Material seed data for generating problems
const materials = [
  { code: 'DCS-3200', name: '分散控制系统', parts: ['主控单元', 'I/O模块', '通信卡件', '电源模块', '冗余控制器'] },
  { code: 'PLC-1500', name: '可编程控制器', parts: ['CPU模块', '数字量输入', '模拟量输出', '通信处理器', '电源供应器'] },
  { code: 'SIS-4100', name: '安全仪表系统', parts: ['逻辑解算器', '安全I/O', '投票模块', '诊断模块', '旁路开关'] },
  { code: 'FCS-2800', name: '现场总线控制系统', parts: ['现场总线接口', '终端电阻', '中继器', '网桥模块', '诊断工具'] },
  { code: 'SCADA-900', name: '监控与数据采集', parts: ['RTU终端', '通信网关', 'HMI工作站', '数据服务器', '报警管理'] },
  { code: 'APC-700', name: '先进过程控制', parts: ['优化引擎', '模型预测', '软测量模块', '自适应调节', '性能评估'] },
  { code: 'VDS-150', name: '振动监测系统', parts: ['振动传感器', '信号调理器', '采集卡', '分析软件', '报警单元'] },
  { code: 'TMR-600', name: '三重冗余系统', parts: ['冗余处理器', '同步模块', '表决器', '故障切换', '诊断面板'] },
  { code: 'ESD-500', name: '紧急停车系统', parts: ['急停按钮', '安全继电器', '逻辑模块', '输出驱动', '复位单元'] },
  { code: 'MES-2000', name: '制造执行系统', parts: ['生产调度', '批次管理', '质量追溯', '设备管理', '报表引擎'] },
]

const materialCodes = ['CCU-2000', 'SCU-1500', 'MCU-800', 'DCU-300', 'IOU-120', 'PSU-500', 'TCU-900', 'RCU-400', 'ACU-250', 'FCU-100']

// Category types for problems
const problemCategories = [
  { name: '未出库-待发货确认', type: 1 },
  { name: '未出库-库存不足', type: 2 },
  { name: '未出库-物流安排中', type: 3 },
  { name: '已出库-待客户签收', type: 4 },
]

// ---- Insert orders ----
const insertOrder = db.prepare(`INSERT INTO analysis_orders (id, analysis_task_id, contract_number, customer, amount, shipment_ratio, status, status_class, sales, region, order_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const insertCat = db.prepare('INSERT INTO analysis_problem_categories (id, order_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)')
const insertProb = db.prepare('INSERT INTO analysis_problems (id, category_id, material_code, material_name, part_name, part_number, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
const insertTodo = db.prepare('INSERT INTO analysis_todos (id, order_id, category, description, priority, assignee, supervisor, due_date, status, task_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const insertDetail = db.prepare('INSERT INTO analysis_card_details (id, problem_id, material_info_json, ai_analysis, delivery_path_json) VALUES (?, ?, ?, ?, ?)')
const insertDT = db.prepare('INSERT INTO analysis_delivery_tables (id, order_id, title, badge, items_json) VALUES (?, ?, ?, ?, ?)')

let todoIdx = 0

rawData.forEach((row, ri) => {
  const orderId = `${taskId}_${row.contractNo}`
  const amount = row.amount
  const shipmentRatio = parseShipmentRatio(row.shipmentRatio)
  const undeliveredQty = parseNumber(row.undeliveredQty)
  const undeliveredAmount = parseNumber(row.undeliveredAmount)
  const orderQty = parseNumber(row.orderQty)
  const paymentRatio = parseRatio(row.paymentRatio)
  const orderDate = getDateFromContract(row.contractNo)

  const statusClass = getStatusClass(shipmentRatio)
  const status = getStatus(shipmentRatio, undeliveredQty)

  insertOrder.run(orderId, taskId, row.contractNo, row.customer, amount, shipmentRatio, status, statusClass, getSales(ri), getRegion(ri), orderDate)

  // Generate problems for orders with undelivered items
  if (undeliveredQty > 0) {
    const numCategories = undeliveredQty > 50 ? 4 : undeliveredQty > 5 ? 3 : undeliveredQty > 1 ? 2 : 1
    let probCount = 0

    for (let ci = 0; ci < numCategories; ci++) {
      const cat = problemCategories[ci]
      const catId = `${orderId}_cat_${ci}`
      insertCat.run(catId, orderId, cat.name, cat.type, ci)

      // Number of problems per category: proportional to undelivered qty
      const numProbs = ci === 0 ? Math.min(Math.ceil(undeliveredQty / 3), 6) : Math.min(Math.ceil(undeliveredQty / 5), 4)

      for (let pi = 0; pi < numProbs; pi++) {
        const mat = materials[(ri + ci + pi) % materials.length]
        const partIdx = (ri + ci + pi) % mat.parts.length
        const mc = materialCodes[(ri + ci * 3 + pi) % materialCodes.length]
        const probId = `${catId}_prob_${pi}`

        const tags = JSON.stringify([
          { label: cat.type === 1 ? '待发货' : cat.type === 2 ? '缺货' : cat.type === 3 ? '物流中' : '运输中', variant: 'pill' },
          ...(ci === 0 && pi === 0 ? [{ label: '紧急', variant: 'urgent' }] : []),
          ...(paymentRatio === 0 ? [{ label: '未回款', variant: 'urgent' }] : []),
        ])

        insertProb.run(probId, catId, mc, mat.name, mat.parts[partIdx], `HT${String(100000 + ri * 100 + ci * 10 + pi).slice(1)}`, tags, ci === 0 && pi === 0 ? '待处理' : '待处理')

        // Card detail for first problem of first category
        if (ci === 0 && pi === 0) {
          const materialInfo = JSON.stringify({
            '物料编码': mc,
            '物料名称': mat.name,
            '部件名称': mat.parts[partIdx],
            '需求数量': orderQty,
            '未出库数量': undeliveredQty,
            '未出库金额': undeliveredAmount.toLocaleString(),
            '发货比例': row.shipmentRatio,
            '已回款比例': `${paymentRatio}%`,
          })
          const aiAnalysis = `${mc} ${mat.name} · ${mat.parts[partIdx]}（合同：${row.contractNo}）当前未出库数量 ${undeliveredQty}，未出库金额 ${undeliveredAmount.toLocaleString()} 元，发货比例为 ${row.shipmentRatio}。${undeliveredAmount > 100000 ? '该物料涉及金额较大，需优先协调发货。' : ''}${paymentRatio === 0 ? '该合同尚未回款，建议跟进客户付款进度。' : ''}${shipmentRatio < 90 ? '发货比例偏低，存在履约风险，建议加快出库节奏。' : ''}`
          const deliveryPath = JSON.stringify([
            { docType: '销售合同', docNo: row.contractNo, badge: 'BPM', qty: orderQty, status: '生效', problemPoint: `合同约定数量${orderQty}，当前未出库${undeliveredQty}` },
            { docType: '发货申请单', docNo: `SA_${row.contractNo.slice(-8)}`, badge: 'BPM', qty: undeliveredQty, status: undeliveredQty > 10 ? '审批中' : '待提交', problemPoint: undeliveredQty > 10 ? '发货申请审批流程较慢' : '发货申请尚未提交' },
            { docType: '销售出库单', docNo: `DN_${row.contractNo.slice(-8)}`, badge: 'SAP', qty: orderQty - undeliveredQty, status: '部分过账', problemPoint: `实际出库${orderQty - undeliveredQty}，差额${undeliveredQty}待出库` },
          ])
          insertDetail.run(`${probId}_detail`, probId, materialInfo, aiAnalysis, deliveryPath)
        }
        probCount++
      }
    }

    // Generate delivery tables for orders with problems
    const dtItems1 = JSON.stringify([
      { docNo: row.contractNo, status: '生效', lineNo: '10', sign: '蓝字', qty: orderQty },
      { docNo: `${row.contractNo}-1`, status: '生效', lineNo: '20', sign: '蓝字', qty: Math.floor(orderQty * 0.3) },
    ])
    const dtItems2 = JSON.stringify([
      { docNo: `SA_${row.contractNo.slice(-8)}`, status: undeliveredQty > 10 ? '审批中' : '待提交', lineNo: '10', sign: '蓝字', qty: undeliveredQty },
    ])
    const dtItems3 = JSON.stringify([
      { docNo: `DN_${row.contractNo.slice(-8)}`, status: '部分过账', lineNo: '10', sign: '蓝字', qty: orderQty - undeliveredQty },
      { docNo: `DN_${row.contractNo.slice(-8)}-2`, status: '待过账', lineNo: '20', sign: '蓝字', qty: undeliveredQty },
    ])

    insertDT.run(`${orderId}_dt_0`, orderId, '销售合同订单', 'BPM', dtItems1)
    insertDT.run(`${orderId}_dt_1`, orderId, '发货申请单', 'BPM', dtItems2)
    insertDT.run(`${orderId}_dt_2`, orderId, '销售出库单', 'SAP', dtItems3)

    // Generate todos
    const todos = [
      { cat: '发货任务', desc: `${row.contractNo} ${row.customer} 未出库物资发货跟进`, prio: undeliveredAmount > 100000 ? 'high' : shipmentRatio < 85 ? 'high' : 'medium', assignee: getSales(ri), supervisor: '张伟', due: '2026-05-25', status: 'pending', type: 'agent' },
    ]
    if (paymentRatio === 0) {
      todos.push({ cat: '回款跟进', desc: `${row.contractNo} ${row.customer} 尚未回款，需联系客户确认付款计划`, prio: 'high', assignee: getSales(ri), supervisor: '王芳', due: '2026-05-22', status: 'pending', type: 'decision' })
    }
    if (undeliveredQty > 50) {
      todos.push({ cat: '异常处理', desc: `${row.contractNo} 未出库数量达${undeliveredQty}，需排查原因并制定出货计划`, prio: 'high', assignee: getSales((ri + 2) % 8), supervisor: '李明', due: '2026-05-23', status: 'pending', type: 'manual' })
    }

    todos.forEach(t => {
      insertTodo.run(`${orderId}_todo_${todoIdx}`, orderId, t.cat, t.desc, t.prio, t.assignee, t.supervisor, t.due, t.status, t.type)
      todoIdx++
    })
  }
})

// Stats
const orderCount = rawData.length
const totalAmount = rawData.reduce((sum, r) => sum + parseNumber(r.amount), 0)
const undeliveredTotal = rawData.reduce((sum, r) => sum + parseNumber(r.undeliveredAmount), 0)
const undeliveredQtyTotal = rawData.reduce((sum, r) => sum + parseNumber(r.undeliveredQty), 0)
const avgShipment = rawData.reduce((sum, r) => sum + parseShipmentRatio(r.shipmentRatio), 0) / rawData.length

console.log('=== 演示数据生成完成 ===')
console.log(`分析任务: ${taskId}`)
console.log(`合同总数: ${orderCount}`)
console.log(`合同总金额: ${totalAmount.toLocaleString()} 元`)
console.log(`未出库总金额: ${undeliveredTotal.toLocaleString()} 元`)
console.log(`未出库总数量: ${undeliveredQtyTotal.toLocaleString()}`)
console.log(`平均发货比例: ${avgShipment.toFixed(2)}%`)
console.log(`数据库路径: ${DB_PATH}`)
db.close()
