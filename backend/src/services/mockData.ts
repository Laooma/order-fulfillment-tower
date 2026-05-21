import type { SalesOrder, TodoTask, AnalysisTask } from '../types'

// ── Helper: generate random order data ──
const customers = [
  '集团贸易有限公司', '工业自动化科技集团', '互联网科技有限公司', '全球供应链有限公司',
  '智慧制造科技集团', '数字贸易发展有限公司', '跨境电商运营有限公司', '企业软件解决方案有限公司',
  '新材料科技股份有限公司', '智能制造装备有限公司', '国际贸易集团有限公司', '精密仪器制造厂',
  '东方钢铁股份有限公司', '南方重工集团有限公司', '西部矿业股份有限公司', '华北电力设备有限公司',
  '华东精密机械制造厂', '中国铁制股份有限公司', '合肥蜀山中转场物流', '安徽铜业集团',
  '江苏精密科技有限公司', '浙江工贸实业有限公司', '上海国际贸易中心', '广东重工装备集团',
  '山东钢铁物流有限公司', '福建智能制造股份', '湖北电力设备集团', '湖南新材料科技',
]

const brands = ['产品品牌A', '工业品牌B', '工贸品牌C', '贸易品牌D', '产品品牌E', '工业品牌F']
const salespeople = ['李明', '张伟', '王芳', '刘洋', '陈静', '赵磊', '孙晶', '周辉', '吴强', '郑丽']
const shipMethods = ['直发客户', '集货发货', '中转仓发货', '海外直发']

function randItem<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pad(n: number) { return String(n).padStart(2, '0') }
function formatDate(d: Date) { return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` }

function generateOrders(count: number): SalesOrder[] {
  const orders: SalesOrder[] = []
  const baseDate = new Date('2025-01-01')
  for (let i = 0; i < count; i++) {
    const id = `HT2025${pad(randInt(1, 99))}${String(i + 1).padStart(3, '0')}`
    const contractNumber = `SCJD2025${pad(randInt(1, 12))}${pad(randInt(1, 28))}${String(randInt(1, 999)).padStart(3, '0')}`
    const customer = randItem(customers)
    const brand = randItem(brands)
    const salesperson = randItem(salespeople)
    const orderDate = formatDate(new Date(baseDate.getTime() + randInt(0, 120) * 86400000))
    const deliveryDays = randInt(15, 60)
    const shipMethod = randItem(shipMethods)
    const skuCount = randInt(1, 12)
    const amount = randInt(50, 500) * 10000 + randInt(0, 99) * 1000
    const shipmentRatio = randInt(0, 100)
    const receiptRatio = Math.min(100, Math.floor(shipmentRatio * (0.7 + Math.random() * 0.35)))
    const isException = Math.random() < 0.25
    orders.push({
      id, contractNumber, customer, brand, salesperson, orderDate,
      deliveryDays, shipMethod, skuCount, amount, receiptRatio, shipmentRatio, isException,
    })
  }
  return orders
}

export const mockOrders: SalesOrder[] = generateOrders(60)

// ── Tasks ──
const taskTitles = [
  '确认发货计划', '核对出库单信息', '确认运输车辆安排', '签署发货通知单', '更新物流跟踪编号',
  '生成发货清单PDF', '核对运输路线', '打印装箱单标签', '确认分批发货方案', '核对收货地址',
  '更新客户联系人', '确认运费结算方式', '办理入库登记手续', '核对入库数量与合同', '质检报告归档',
  '生成入库验收单', '确认入库仓库分配', '登记物料批次号', '核对质检参数偏差', '确认合同价格变更条款',
  '签署补充协议', '更新客户主体信息', '校验合同金额一致性', '更新付款条款', '批准合同延期申请',
  '提取合同关键条款', '归档合同签字版', '发货地址错误修正', '物流丢失件理赔跟进', '供应商延迟发货沟通',
  '记录质量异常台账', '启动加急发货流程', '异常预警规则配置', '预约承运商上门取货', '核对发票信息',
  '确认客户签收状态', '更新库存占用数据', '生成月度履约报告', '核对采购订单与合同', '确认包装规格',
  '安排第三方质检', '更新交货期承诺', '协调中转仓入库', '确认海关报关资料', '生成出口许可证',
]

const assignees = ['李明', '张伟', '王芳', '刘洋', '陈静', '赵磊', '孙晶', '周辉', '吴强', '郑丽', '赵强', '陈敏']
const priorities: Array<{ p: 'high' | 'mid' | 'low'; label: string }> = [
  { p: 'high', label: '高' }, { p: 'mid', label: '中' }, { p: 'low', label: '低' },
]
const statuses: Array<{ s: 'pending' | 'progress' | 'overdue' | 'done'; label: string }> = [
  { s: 'pending', label: '待开始' }, { s: 'progress', label: '进行中' },
  { s: 'overdue', label: '逾期' }, { s: 'done', label: '已完成' },
]
const categories: Array<{ c: 'ship' | 'inbound' | 'contract' | 'exception'; label: string }> = [
  { c: 'ship', label: '发货任务' }, { c: 'inbound', label: '入库任务' },
  { c: 'contract', label: '合同确认' }, { c: 'exception', label: '异常处理' },
]
const types: Array<{ t: 'agent' | 'decision' | 'manual'; label: string }> = [
  { t: 'agent', label: 'Agent任务' }, { t: 'decision', label: '决策任务' }, { t: 'manual', label: '手工任务' },
]

function generateTasks(count: number): TodoTask[] {
  const tasks: TodoTask[] = []
  const contractIds = mockOrders.slice(0, 20).map((o) => o.contractNumber)
  for (let i = 0; i < count; i++) {
    const typeObj = randItem(types)
    const prioObj = randItem(priorities)
    const statusObj = randItem(statuses)
    const catObj = randItem(categories)
    tasks.push({
      id: `T-${2024}-${pad(randInt(1, 12))}${pad(randInt(1, 28))}-${String(i + 1).padStart(3, '0')}`,
      contractId: randItem(contractIds),
      type: typeObj.t,
      typeLabel: typeObj.label,
      title: randItem(taskTitles),
      description: `${randItem(['华北大区', '华东大区', '华南大区', '西部大区'])} · ${randItem(['安徽', '河北', '江苏', '广东', '四川', '山西'])} · ${randItem(['铜精矿', '铁矿石', '控制板', '变频器', '电源模块'])}`,
      priority: prioObj.p,
      priorityLabel: prioObj.label,
      assignee: randItem(assignees),
      dueDate: `2024/${pad(randInt(11, 12))}/${pad(randInt(1, 30))}`,
      status: statusObj.s,
      statusLabel: statusObj.label,
      category: catObj.c,
      categoryLabel: catObj.label,
    })
  }
  return tasks
}

export const mockTasks: TodoTask[] = generateTasks(80)

// ── Analysis Tasks ──
const analysisTitles = [
  '华东仓库存自动核验', '智能异常单键执行', '承运商自动优选', '信用额度自动核验', '电子面单自动生成',
  '发货通知单触发', '物流轨迹实时触车', '预计送达时间计算', '签收自动确认', '仓库库存自动预警',
  'HT20250003 异常分析', '第Q1季度发货进度盘点', '智慧制造HT20250005采购对齐', '跨境电商订单风险评估',
  '集团贸易到货确认', 'Q1全量履约数据导出', '精密制造HT20250010催货方案', '合同履约率趋势分析',
  '物料短缺预警分析', 'FAT计划排程优化', '供应商交付能力评估', '客户满意度归因分析',
  '库存周转率诊断', '运输成本结构分析', '质量问题根因分析',
]

const analysisAgents = ['系统Agent', '运营Agent', '仓储Agent', '风控Agent', '产品型销售订单确认收入智能体', '工程项目订单履约专家', '物料预缺与齐套分析专家', 'FAT计划助手']
const initiators = ['王经理', '李主管', '张总监', '财务总监', '客服经理', '仓储部经理', 'Hi·金星米', '系统']
const analysisStatuses = ['已完成', '处理中', '待处理', '审批中', '已驳回']

function generateAnalysisTasks(count: number): AnalysisTask[] {
  const tasks: AnalysisTask[] = []
  const baseDate = new Date('2026-05-10')
  for (let i = 0; i < count; i++) {
    const created = new Date(baseDate.getTime() + randInt(0, 8) * 86400000 + randInt(0, 23) * 3600000)
    const status = randItem(analysisStatuses)
    const completed = status === '已完成' ? new Date(created.getTime() + randInt(5, 120) * 60000) : null
    tasks.push({
      id: `T20260518${String(i + 1).padStart(3, '0')}`,
      title: analysisTitles[i % analysisTitles.length] + (i >= analysisTitles.length ? ` (${i - analysisTitles.length + 2})` : ''),
      taskType: randItem(['agent任务', '决策任务', '手工任务']),
      description: `分析 ${randInt(1, 10)} 个订单的履约状态，识别 ${randInt(0, 5)} 个风险点`,
      agent: randItem(analysisAgents),
      initiator: randItem(initiators),
      status,
      createdAt: created.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '/'),
      completedAt: completed ? completed.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '/') : '',
      relatedContracts: Array.from({ length: randInt(1, 3) }, () => `SCJD2025${pad(randInt(1, 12))}${pad(randInt(1, 28))}${String(randInt(1, 999)).padStart(3, '0')}`),
    })
  }
  return tasks
}

export const mockAnalysisTasks: AnalysisTask[] = generateAnalysisTasks(30)
