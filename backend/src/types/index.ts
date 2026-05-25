export interface SalesOrder {
  id: string
  contractNumber: string
  customer: string
  brand: string
  salesperson: string
  orderDate: string
  deliveryDays: number
  shipMethod: string
  skuCount: number
  amount: number
  receiptRatio: number
  shipmentRatio: number
  isException: boolean
}

export interface TodoTask {
  id: string
  contractId: string
  type: 'agent' | 'decision' | 'manual'
  typeLabel: string
  title: string
  description: string
  priority: 'high' | 'mid' | 'low'
  priorityLabel: string
  assignee: string
  supervisor?: string
  dueDate: string
  status: 'pending' | 'progress' | 'overdue' | 'done'
  statusLabel: string
  category: 'ship' | 'inbound' | 'contract' | 'exception'
  categoryLabel: string
  skillId?: string
  skillName?: string
}

export interface AnalysisTask {
  id: string
  title: string
  taskType: string
  description: string
  agent: string
  initiator: string
  status: string
  createdAt: string
  completedAt: string
  relatedContracts: string[]
  skillId?: string
  skillName?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface CabinetPackage {
  id: string
  orderId: string
  customer: string
  status: 'designing' | 'stock_preparing' | 'pending_assembly' | 'assembling' | 'completed' | 'shipped'
  designCompletedAt: string
  stockReadyAt: string
  estimatedAssemblyAt: string
  actualAssemblyAt: string
  assemblyCompletedAt: string
  shipStatus: '未发货' | '已发货' | '部分发货'
  factory: string
}

export interface WsMessage {
  type: 'chat' | 'chunk' | 'complete' | 'error'
  sessionId?: string
  message?: string
  content?: string
  analysisId?: string
  redirect?: string
  orders?: string[]
  cabinetPackages?: string[]
}

export interface BizContract {
  id: string
  contract_no: string
  customer: string
  sign_date: string
  status: string
  amount: number
}

export interface BizDevice {
  id: string
  contract_id: string
  device_name: string
  device_code: string
  quantity: number
  planned_start: string
  planned_finish: string
}

export interface BizPackage {
  id: string
  device_id: string
  package_name: string
  package_code: string
  planned_production: string
  quantity: number
  status: string
}

export interface BizMaterial {
  id: string
  package_id: string
  material_code: string
  material_name: string
  spec: string
  unit: string
  required_qty: number
  current_stock: number
  in_transit: number
  shortage_qty: number
  supplier: string
  lead_time_days: number
  kit_status: string
}

export interface BizMaterialDailyBalance {
  id: string
  material_id: string
  date: string
  supply_qty: number
  demand_qty: number
  balance: number
  cumulative_balance: number
  note: string
}
