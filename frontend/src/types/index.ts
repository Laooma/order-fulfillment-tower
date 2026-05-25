export type TaskType = 'agent' | 'decision' | 'manual'

export type TaskStatus = 'pending' | 'progress' | 'overdue' | 'done'

export type BusinessType = 'ship' | 'inbound' | 'contract' | 'exception'

export type Priority = 'high' | 'mid' | 'low'

export interface SalesOrder {
  id: string
  contractNumber: string
  customer: string
  amount: number
  deliveryStatus: string
  shipmentRatio: number
}

export interface AnalysisTask {
  id: string
  title: string
  agent: string
  createdAt: string
  orderCount: number
  issueCount: number
  status: TaskStatus
  skillId?: string
  skillName?: string
}

export interface IssueCard {
  id: string
  materialCode: string
  materialName: string
  description: string
  severity: Priority
  lane: string
}

export interface IssueLane {
  id: string
  name: string
  cards: IssueCard[]
}

export interface TodoTask {
  id: string
  contractId: string
  type: TaskType
  typeLabel: string
  title: string
  description: string
  priority: Priority
  priorityLabel: string
  assignee: string
  supervisor?: string
  dueDate: string
  status: TaskStatus
  statusLabel: string
  category: BusinessType
  categoryLabel: string
  skillId?: string
  skillName?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
}

export interface User {
  name: string
  initials: string
  role: string
}
