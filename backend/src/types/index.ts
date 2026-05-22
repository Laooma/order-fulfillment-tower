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
  dueDate: string
  status: 'pending' | 'progress' | 'overdue' | 'done'
  statusLabel: string
  category: 'ship' | 'inbound' | 'contract' | 'exception'
  categoryLabel: string
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
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface CabinetPackage {
  id: string
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
}
