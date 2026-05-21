import { create } from 'zustand'
import type { TodoTask, TaskType, TaskStatus, BusinessType } from '../types'

const mockTasks: TodoTask[] = [
  { id:'T-20241114-001', contractId:'SCJD20241114-K01', type:'agent', typeLabel:'Agent任务', title:'确认发货计划', description:'华北大区 · 安徽仓库 · 铜精矿 5000吨', priority:'high', priorityLabel:'高', assignee:'张伟', dueDate:'2024/11/16', status:'overdue', statusLabel:'逾期', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-002', contractId:'SCJD20241114-K01', type:'manual', typeLabel:'手工任务', title:'核对出库单信息', description:'含铁品位 63.5% · 湿吨计价', priority:'high', priorityLabel:'高', assignee:'李明', dueDate:'2024/11/17', status:'progress', statusLabel:'进行中', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-003', contractId:'SCJD20241114-K02', type:'decision', typeLabel:'决策任务', title:'确认运输车辆安排', description:'山西太原 · 要求13米平板车', priority:'mid', priorityLabel:'中', assignee:'王芳', dueDate:'2024/11/18', status:'progress', statusLabel:'进行中', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-004', contractId:'SCJD20241114-K01', type:'decision', typeLabel:'决策任务', title:'签署发货通知单', description:'需三方签章 · 电子签', priority:'high', priorityLabel:'高', assignee:'赵强', dueDate:'2024/11/15', status:'overdue', statusLabel:'逾期', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-005', contractId:'SCJD20241114-K03', type:'manual', typeLabel:'手工任务', title:'更新物流跟踪编号', description:'SF-20241114-0892', priority:'low', priorityLabel:'低', assignee:'陈敏', dueDate:'2024/11/20', status:'pending', statusLabel:'待开始', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-006', contractId:'SCJD20241114-K04', type:'agent', typeLabel:'Agent任务', title:'生成发货清单PDF', description:'含装箱单 · 检测报告 · 原产地证', priority:'mid', priorityLabel:'中', assignee:'张伟', dueDate:'2024/11/19', status:'progress', statusLabel:'进行中', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-007', contractId:'SCJD20241114-K02', type:'agent', typeLabel:'Agent任务', title:'核对运输路线', description:'太原→天津港 · 陆运+海运', priority:'low', priorityLabel:'低', assignee:'王芳', dueDate:'2024/11/22', status:'pending', statusLabel:'待开始', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-008', contractId:'SCJD20241114-K05', type:'manual', typeLabel:'手工任务', title:'打印装箱单标签', description:'每箱贴二维码 · 共24箱', priority:'mid', priorityLabel:'中', assignee:'张伟', dueDate:'2024/11/18', status:'done', statusLabel:'已完成', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-009', contractId:'SCJD20241114-K04', type:'decision', typeLabel:'决策任务', title:'确认分批发货方案', description:'第一批60% · 第二批40% · 间隔7天', priority:'high', priorityLabel:'高', assignee:'赵强', dueDate:'2024/11/16', status:'progress', statusLabel:'进行中', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-010', contractId:'SCJD20241114-K03', type:'agent', typeLabel:'Agent任务', title:'核对收货地址', description:'华东区 · 上海市浦东新区 · 核对邮编', priority:'low', priorityLabel:'低', assignee:'李明', dueDate:'2024/11/25', status:'pending', statusLabel:'待开始', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-011', contractId:'SCJD20241114-K01', type:'manual', typeLabel:'手工任务', title:'更新客户联系人', description:'新增联系人王经理 · 电话核实', priority:'mid', priorityLabel:'中', assignee:'张伟', dueDate:'2024/11/21', status:'progress', statusLabel:'进行中', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-012', contractId:'SCJD20241114-K02', type:'decision', typeLabel:'决策任务', title:'确认运费结算方式', description:'预付30%+到付70% · 需财务审批', priority:'mid', priorityLabel:'中', assignee:'王芳', dueDate:'2024/11/20', status:'progress', statusLabel:'进行中', category:'ship', categoryLabel:'发货任务' },
  { id:'T-20241114-019', contractId:'SCJD20241114-K02', type:'manual', typeLabel:'手工任务', title:'办理入库登记手续', description:'山西太原仓 · 预计11月18日到货', priority:'high', priorityLabel:'高', assignee:'张伟', dueDate:'2024/11/19', status:'pending', statusLabel:'待开始', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-020', contractId:'SCJD20241114-K01', type:'agent', typeLabel:'Agent任务', title:'核对入库数量与合同', description:'铜精矿 · 允差±2%', priority:'mid', priorityLabel:'中', assignee:'李明', dueDate:'2024/11/21', status:'progress', statusLabel:'进行中', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-021', contractId:'SCJD20241114-K04', type:'manual', typeLabel:'手工任务', title:'质检报告归档', description:'铁矿石 · 品位检测报告', priority:'low', priorityLabel:'低', assignee:'王芳', dueDate:'2024/11/25', status:'pending', statusLabel:'待开始', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-022', contractId:'SCJD20241114-K03', type:'agent', typeLabel:'Agent任务', title:'生成入库验收单', description:'自动填充合同条款 · 质检参数', priority:'mid', priorityLabel:'中', assignee:'陈敏', dueDate:'2024/11/20', status:'progress', statusLabel:'进行中', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-023', contractId:'SCJD20241114-K05', type:'decision', typeLabel:'决策任务', title:'确认入库仓库分配', description:'A仓已满 · 需改配B仓 · 增加运费', priority:'high', priorityLabel:'高', assignee:'赵强', dueDate:'2024/11/17', status:'overdue', statusLabel:'逾期', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-024', contractId:'SCJD20241114-K04', type:'manual', typeLabel:'手工任务', title:'登记物料批次号', description:'铁矿石 · 批次HT2025-B03', priority:'low', priorityLabel:'低', assignee:'张伟', dueDate:'2024/11/28', status:'pending', statusLabel:'待开始', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-025', contractId:'SCJD20241114-K01', type:'agent', typeLabel:'Agent任务', title:'核对质检参数偏差', description:'铜品位偏差0.3% · 需技术确认', priority:'mid', priorityLabel:'中', assignee:'李明', dueDate:'2024/11/23', status:'progress', statusLabel:'进行中', category:'inbound', categoryLabel:'入库任务' },
  { id:'T-20241114-029', contractId:'SCJD20241114-K03', type:'decision', typeLabel:'决策任务', title:'确认合同价格变更条款', description:'铜价波动触发调价机制 · 浮动±3%', priority:'high', priorityLabel:'高', assignee:'赵强', dueDate:'2024/11/15', status:'overdue', statusLabel:'逾期', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-030', contractId:'SCJD20241114-K05', type:'decision', typeLabel:'决策任务', title:'签署补充协议', description:'交货期调整至12月 · 需双方签章', priority:'high', priorityLabel:'高', assignee:'李明', dueDate:'2024/11/18', status:'progress', statusLabel:'进行中', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-031', contractId:'SCJD20241114-K01', type:'manual', typeLabel:'手工任务', title:'更新客户主体信息', description:'中国铁制股份有限公司 · 华北大区', priority:'low', priorityLabel:'低', assignee:'陈敏', dueDate:'2024/11/28', status:'pending', statusLabel:'待开始', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-032', contractId:'SCJD20241114-K04', type:'agent', typeLabel:'Agent任务', title:'校验合同金额一致性', description:'对比ERP与CRM数据 · 差异0.5%内', priority:'mid', priorityLabel:'中', assignee:'张伟', dueDate:'2024/11/22', status:'progress', statusLabel:'进行中', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-033', contractId:'SCJD20241114-K02', type:'manual', typeLabel:'手工任务', title:'更新付款条款', description:'新增信用证支付方式', priority:'low', priorityLabel:'低', assignee:'王芳', dueDate:'2024/11/30', status:'pending', statusLabel:'待开始', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-034', contractId:'SCJD20241114-K05', type:'decision', typeLabel:'决策任务', title:'批准合同延期申请', description:'客户申请延期15天 · 不可抗力条款', priority:'high', priorityLabel:'高', assignee:'赵强', dueDate:'2024/11/17', status:'progress', statusLabel:'进行中', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-035', contractId:'SCJD20241114-K03', type:'agent', typeLabel:'Agent任务', title:'提取合同关键条款', description:'生成条款摘要 · 标记风险点', priority:'mid', priorityLabel:'中', assignee:'李明', dueDate:'2024/11/24', status:'progress', statusLabel:'进行中', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-036', contractId:'SCJD20241114-K01', type:'manual', typeLabel:'手工任务', title:'归档合同签字版', description:'双方已签章 · 上传扫描件', priority:'low', priorityLabel:'低', assignee:'张伟', dueDate:'2024/11/26', status:'done', statusLabel:'已完成', category:'contract', categoryLabel:'合同确认' },
  { id:'T-20241114-037', contractId:'SCJD20241114-K02', type:'agent', typeLabel:'Agent任务', title:'发货地址错误修正', description:'原地址：山西太原A仓 → 应发B仓', priority:'high', priorityLabel:'高', assignee:'张伟', dueDate:'2024/11/14', status:'overdue', statusLabel:'逾期', category:'exception', categoryLabel:'异常处理' },
  { id:'T-20241114-038', contractId:'SCJD20241114-K04', type:'agent', typeLabel:'Agent任务', title:'物流丢失件理赔跟进', description:'运单SF202411090032 · 理赔中', priority:'high', priorityLabel:'高', assignee:'王芳', dueDate:'2024/11/17', status:'progress', statusLabel:'进行中', category:'exception', categoryLabel:'异常处理' },
  { id:'T-20241114-039', contractId:'SCJD20241114-K03', type:'decision', typeLabel:'决策任务', title:'供应商延迟发货沟通', description:'预计延迟3天 · 客户已通知', priority:'mid', priorityLabel:'中', assignee:'赵强', dueDate:'2024/11/19', status:'progress', statusLabel:'进行中', category:'exception', categoryLabel:'异常处理' },
  { id:'T-20241114-040', contractId:'SCJD20241114-K05', type:'manual', typeLabel:'手工任务', title:'记录质量异常台账', description:'铁矿石品位偏差 · 取样复检', priority:'mid', priorityLabel:'中', assignee:'陈敏', dueDate:'2024/11/20', status:'pending', statusLabel:'待开始', category:'exception', categoryLabel:'异常处理' },
  { id:'T-20241114-041', contractId:'SCJD20241114-K01', type:'decision', typeLabel:'决策任务', title:'启动加急发货流程', description:'客户要求提前7天 · 评估可行性', priority:'high', priorityLabel:'高', assignee:'李明', dueDate:'2024/11/16', status:'progress', statusLabel:'进行中', category:'exception', categoryLabel:'异常处理' },
  { id:'T-20241114-042', contractId:'SCJD20241114-K04', type:'agent', typeLabel:'Agent任务', title:'异常预警规则配置', description:'设置发货延迟·质检不合格自动预警', priority:'low', priorityLabel:'低', assignee:'张伟', dueDate:'2024/11/30', status:'done', statusLabel:'已完成', category:'exception', categoryLabel:'异常处理' },
]

interface TaskState {
  tasks: TodoTask[]
  filterType: TaskType | 'all'
  filterStatus: TaskStatus | 'all'
  filterBusiness: BusinessType | 'all'
  filterContract: string
  filterAssignee: string
  filterPriority: string
  searchQuery: string
  currentPage: number
  pageSize: number
  setFilterType: (t: TaskType | 'all') => void
  setFilterStatus: (s: TaskStatus | 'all') => void
  setFilterBusiness: (b: BusinessType | 'all') => void
  setFilterContract: (c: string) => void
  setFilterAssignee: (a: string) => void
  setFilterPriority: (p: string) => void
  setSearchQuery: (q: string) => void
  setCurrentPage: (p: number) => void
  setPageSize: (s: number) => void
  resetFilters: () => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: mockTasks,
  filterType: 'all',
  filterStatus: 'all',
  filterBusiness: 'all',
  filterContract: 'all',
  filterAssignee: 'all',
  filterPriority: 'all',
  searchQuery: '',
  currentPage: 1,
  pageSize: 20,
  setFilterType: (t) => set({ filterType: t, currentPage: 1 }),
  setFilterStatus: (s) => set({ filterStatus: s, currentPage: 1 }),
  setFilterBusiness: (b) => set({ filterBusiness: b, currentPage: 1 }),
  setFilterContract: (c) => set({ filterContract: c, currentPage: 1 }),
  setFilterAssignee: (a) => set({ filterAssignee: a, currentPage: 1 }),
  setFilterPriority: (p) => set({ filterPriority: p, currentPage: 1 }),
  setSearchQuery: (q) => set({ searchQuery: q, currentPage: 1 }),
  setCurrentPage: (p) => set({ currentPage: p }),
  setPageSize: (s) => set({ pageSize: s, currentPage: 1 }),
  resetFilters: () => set({
    filterType: 'all',
    filterStatus: 'all',
    filterBusiness: 'all',
    filterContract: 'all',
    filterAssignee: 'all',
    filterPriority: 'all',
    searchQuery: '',
    currentPage: 1,
  }),
}))
