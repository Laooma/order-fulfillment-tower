export type ExecutionStepType = 'agent' | 'manual' | 'decision'
export type ExecutionTaskStatus = 'pending' | 'progress' | 'overdue' | 'done'
export type ExecutionPriority = 'high' | 'medium' | 'low'

export interface ExecutionTask {
  id: string
  title: string
  description: string
  category: string
  priority: ExecutionPriority
  status: ExecutionTaskStatus
  assignee: string
  supervisor: string
  due_date: string
  source_analysis_task_id: string
  order_id: string
  contract_number: string
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string
  steps?: ExecutionStep[]
  stepCount?: number
}

export interface ExecutionStep {
  id: string
  execution_task_id: string
  step_order: number
  step_type: ExecutionStepType
  title: string
  description: string
  status: ExecutionTaskStatus
  assignee: string
  handler: string
  started_at: string
  completed_at: string
  stay_duration: number
  result_data: string
  resultData?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface DecisionOption {
  id: string
  step_id: string
  option_order: number
  title: string
  description: string
  estimated_duration: string
  risk_level: string
  cost_estimate: string
  is_selected: number
  created_at: string
}

export interface TaskHandoverRecord {
  id: string
  execution_task_id: string
  from_user: string
  to_user: string
  reason: string
  handed_by: string
  created_at: string
}
