export interface SkillFile {
  id: string       // relative path: "references/api-guide.md" or "scripts/helper.sh"
  name: string     // display name (filename)
  content?: string // file content (only in full/detail responses)
}

export interface Skill {
  id: string
  name: string
  description: string
  icon: string
  color: string
  prompt: string                      // SKILL.md body
  references: SkillFile[]             // references/* files
  scripts: SkillFile[]               // scripts/* files
  templates: SkillFile[]              // scripts/templates/* files
  allowedTools?: string[]
  userInvocable: boolean
  disableModelInvocation: boolean
  model?: string
}

export interface Hook {
  id: string
  name: string
  description: string
  event: 'before_chat' | 'after_chat' | 'before_tool_call' | 'after_tool_call' | 'on_error'
  script: string
  enabled: boolean
  matcher: string
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy?: string[]
  verified?: boolean
}

export interface AgentMessage {
  type: 'chat' | 'chunk' | 'complete' | 'error' | 'tool_call' | 'tool_result' | 'skill_assigned' | 'status' | 'todo_list' | 'abort' | 'plan_mode' | 'plan_saved' | 'context_update' | 'context_warning'
  sessionId?: string
  skillId?: string
  autoAssign?: boolean
  model?: string
  message?: string
  content?: string
  currentPage?: string
  orders?: string[]
  cabinetPackages?: string[]
  taskId?: string
  analysisId?: string
  analysisTitle?: string
  redirect?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolLabel?: string
  assignedSkillId?: string
  assignedSkillName?: string
  status?: 'thinking' | 'calling_tool' | 'responding'
  skillName?: string
  skillIcon?: string
  skillColor?: string
  modelId?: string
  elapsed?: number
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  contextWindow?: number
  errorMessage?: string
  todos?: TodoItem[]
  action?: 'create' | 'update'
  incompleteTasks?: string[]
}

export interface Session {
  id: string
  skillId: string
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; reasoningContent?: string; toolCallId?: string; toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }>
  createdAt: number
  updatedAt: number
  workDir: string
  cumulativeInputTokens: number
  compactionCount: number
}

export interface CompactionConfig {
  preserveRecentMessages: number
  maxEstimatedTokens: number
  triggerTokenThreshold: number
  maxSummaryChars: number
  maxSummaryLines: number
  maxLineChars: number
}

export interface CompactionResult {
  removedCount: number
  summaryLength: number
  newMessageCount: number
}

export interface McpCallContext {
  workDir?: string
  env?: Record<string, string>
}

export class McpPoolExhaustedError extends Error {
  constructor(timeoutMs: number) {
    super(`MCP pool exhausted: no client available within ${timeoutMs}ms`)
    this.name = 'McpPoolExhaustedError'
  }
}

export interface VolcanoRequest {
  model: string
  messages: Array<{ role: string; content: string; name?: string; reasoning_content?: string; tool_calls?: unknown; tool_call_id?: string }>
  stream?: boolean
  temperature?: number
  tools?: Array<{
    type: string
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpToolCallParams {
  name: string
  arguments: Record<string, unknown>
}

export interface McpServer {
  id: string
  name: string
  description: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  autoConnect: boolean
}

export interface CronTask {
  id: string
  name: string
  description: string
  enabled: boolean
  schedule: string
  script: string
  scriptType: 'bash' | 'python' | 'js'
  callAgent: boolean
  agentSkillId?: string
  agentPrompt?: string
  createdAt: string
  updatedAt: string
}

export interface Plugin {
  id: string
  name: string
  description: string
  version: string
  type: 'tool' | 'hook' | 'route' | 'middleware'
  entry: string
  enabled: boolean
  config: Record<string, unknown>
}
