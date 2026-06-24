const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'
const AGENT_BASE = import.meta.env.VITE_AGENT_BASE_URL || 'http://localhost:3002'

function getToken(): string | null {
  try {
    return localStorage.getItem('auth_token')
  } catch {
    return null
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (options?.headers) {
    Object.assign(headers, options.headers)
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function agentRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export interface SkillFile {
  id: string
  name: string
  content?: string
}

export interface Skill {
  id: string
  name: string
  description: string
  icon: string
  color: string
  prompt?: string
  references?: SkillFile[]
  scripts?: SkillFile[]
  templates?: SkillFile[]
  allowedTools?: string[]
  userInvocable?: boolean
  disableModelInvocation?: boolean
  model?: string
}

export interface Hook {
  id: string
  name: string
  description: string
  event: string
  enabled: boolean
  matcher: string
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

export interface Plugin {
  id: string
  name: string
  description: string
  version: string
  type: string
  entry: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface CronTask {
  id: string
  name: string
  description: string
  enabled: boolean
  schedule: string
  script: string
  scriptType: 'bash' | 'python' | 'js' | 'none'
  callAgent: boolean
  agentSkillId?: string
  agentPrompt?: string
  createdAt: string
  updatedAt: string
}

export interface ToolConfig {
  name: string
  description: string
  enabled: boolean
  source: 'built-in' | 'mcp'
  mcpServer?: string
  parameters?: Record<string, unknown>
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    me: () => request<any>('/auth/me'),
    logout: () => request<any>('/auth/logout', { method: 'POST' }),
    updatePet: (adoptedPetId: string) => request<{ success: boolean }>('/auth/pet', { method: 'PUT', body: JSON.stringify({ adoptedPetId }) }),
  },
  orders: {
    list: (params?: Record<string, string>) =>
      request<PaginatedResponse<any>>(`/orders?${new URLSearchParams(params).toString()}`),
    get: (id: string) => request<any>(`/orders/${id}`),
  },
  cabinetPackages: {
    list: (params?: Record<string, string>) =>
      request<PaginatedResponse<any>>(`/cabinet-packages?${new URLSearchParams(params).toString()}`),
  },
  bizContracts: {
    list: (params?: Record<string, string>) =>
      request<PaginatedResponse<any>>(`/biz-contracts?${new URLSearchParams(params).toString()}`),
    get: (id: string) => request<any>(`/biz-contracts/${id}`),
    devices: (id: string) => request<{ data: any[] }>(`/biz-contracts/${id}/devices`),
    packages: (id: string) => request<{ data: any[] }>(`/biz-contracts/${id}/packages`),
    kitCheck: (id: string) => request<any>(`/biz-contracts/${id}/kit-check`),
  },
  bizPackages: {
    get: (id: string) => request<any>(`/biz-contracts/packages/${id}`),
    kitCheck: (id: string) => request<any>(`/biz-contracts/packages/${id}/kit-check`),
  },
  bizMaterials: {
    get: (id: string) => request<any>(`/biz-contracts/materials/${id}`),
    dailyBalance: (id: string) => request<any>(`/biz-contracts/materials/${id}/daily-balance`),
    search: (code: string) => request<any>(`/biz-contracts/materials/search?code=${encodeURIComponent(code)}`),
    upsert: (data: { contractNo: string; materialCode: string; materialName?: string; currentStock: number; requiredQty?: number }) =>
      request<any>('/biz-contracts/materials/upsert', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateStock: (id: string, currentStock: number) =>
      request<{ success: boolean; id: string; current_stock: number; shortage_qty: number }>(`/biz-contracts/materials/${id}/update-stock`, {
        method: 'PUT',
        body: JSON.stringify({ current_stock: currentStock }),
      }),
  },
  tasks: {
    list: (params?: Record<string, string>) =>
      request<PaginatedResponse<any>>(`/tasks?${new URLSearchParams(params).toString()}`),
    get: (id: string) => request<any>(`/tasks/${id}`),
  },
  executionTasks: {
    list: (params?: Record<string, string>) =>
      request<PaginatedResponse<any>>(`/execution-tasks?${new URLSearchParams(params).toString()}`),
    get: (id: string) => request<any>(`/execution-tasks/${id}`),
    create: (data: any) => request<any>('/execution-tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/execution-tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ success: boolean }>(`/execution-tasks/${id}`, { method: 'DELETE' }),
    migrate: () => request<{ success: boolean; migrated: number }>('/execution-tasks/migrate', { method: 'POST' }),
    steps: (id: string) => request<{ data: any[] }>(`/execution-tasks/${id}/steps`),
    createStep: (id: string, data: any) => request<any>(`/execution-tasks/${id}/steps`, { method: 'POST', body: JSON.stringify(data) }),
    updateStep: (stepId: string, data: any) => request<any>(`/execution-tasks/steps/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }),
    completeStep: (stepId: string, data?: any) => request<any>(`/execution-tasks/steps/${stepId}/complete`, { method: 'PUT', body: JSON.stringify(data || {}) }),
    executeStep: (stepId: string, data?: any) => request<any>(`/execution-tasks/steps/${stepId}/execute`, { method: 'PUT', body: JSON.stringify(data || {}) }),
    options: (stepId: string) => request<{ data: any[] }>(`/execution-tasks/steps/${stepId}/options`),
    createOption: (stepId: string, data: any) => request<any>(`/execution-tasks/steps/${stepId}/options`, { method: 'POST', body: JSON.stringify(data) }),
    decide: (stepId: string, data: any) => request<any>(`/execution-tasks/steps/${stepId}/decide`, { method: 'PUT', body: JSON.stringify(data) }),
    handover: (id: string, data: any) => request<any>(`/execution-tasks/${id}/handover`, { method: 'PUT', body: JSON.stringify(data) }),
    handovers: (id: string) => request<{ data: any[] }>(`/execution-tasks/${id}/handovers`),
  },
  analysis: {
    list: (params?: Record<string, string>) =>
      request<PaginatedResponse<any>>(`/analysis?${new URLSearchParams(params).toString()}`),
    get: (id: string) => request<any>(`/analysis/${id}`),
    full: (id: string) => request<any>(`/analysis/${id}/full`),
    cardDetail: (taskId: string, problemId: string) => request<any>(`/analysis/${taskId}/card/${problemId}`),
    status: (id: string) => request<{ status: string }>(`/analysis/${id}/status`),
    updateStatus: (id: string, status: string) => request<{ success: boolean }>(`/analysis/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    todos: (id: string) => request<{ data: any[] }>(`/analysis/${id}/todos`),
    saveTodos: (id: string, todos: any[]) => request<{ success: boolean }>(`/analysis/${id}/todos`, { method: 'POST', body: JSON.stringify({ todos }) }),
    create: (body: { title: string; orders: string[]; agent?: string }) =>
      request<any>(`/analysis`, { method: 'POST', body: JSON.stringify(body) }),
  },
  agent: {
    skills: () => agentRequest<{ skills: Skill[] }>('/skills'),
    skill: (id: string) => agentRequest<{ skill: Skill }>(`/skills/${id}`),
    skillFull: (id: string) => agentRequest<{ skill: Skill }>(`/skills/${id}/full`),
    skillRaw: (id: string) => agentRequest<{ id: string; content: string }>(`/skills/${id}/raw`),
    skillFile: (id: string, filePath: string) => agentRequest<{ data: { id: string; name: string; content: string } }>(`/skills/${id}/files/${filePath}`),
    saveSkill: (id: string, content: string) => agentRequest<{ success: boolean }>(`/skills/${id}`, { method: 'PUT', body: JSON.stringify({ content }) }),
    saveSkillFile: (id: string, filePath: string, content: string) => agentRequest<{ success: boolean }>(`/skills/${id}/files/${filePath}`, { method: 'PUT', body: JSON.stringify({ content }) }),
    createSkill: (data: { id: string; name: string; description: string; icon: string; color: string; content: string }) => agentRequest<{ success: boolean }>('/skills', { method: 'POST', body: JSON.stringify(data) }),
    deleteSkill: (id: string) => agentRequest<{ success: boolean }>(`/skills/${id}`, { method: 'DELETE' }),
    deleteSkillFile: (id: string, filePath: string) => agentRequest<{ success: boolean }>(`/skills/${id}/files/${filePath}`, { method: 'DELETE' }),
    hooks: () => agentRequest<{ hooks: Hook[] }>('/hooks'),
    hook: (id: string) => agentRequest<{ hook: Hook & { script: string } }>(`/hooks/${id}`),
    hookRaw: (id: string) => agentRequest<{ id: string; content: string }>(`/hooks/${id}/raw`),
    saveHook: (id: string, data: { name: string; description: string; event: string; script: string; enabled: boolean; matcher: string }) => agentRequest<{ success: boolean }>(`/hooks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    createHook: (data: { id: string; name: string; description: string; event: string; script: string; enabled?: boolean; matcher?: string }) => agentRequest<{ success: boolean }>('/hooks', { method: 'POST', body: JSON.stringify(data) }),
    deleteHook: (id: string) => agentRequest<{ success: boolean }>(`/hooks/${id}`, { method: 'DELETE' }),
    mcpServers: () => agentRequest<{ servers: McpServer[] }>('/mcp'),
    mcpServer: (id: string) => agentRequest<{ server: McpServer }>(`/mcp/${id}`),
    mcpServerRaw: (id: string) => agentRequest<{ id: string; content: string }>(`/mcp/${id}/raw`),
    saveMcpServer: (id: string, data: Omit<McpServer, 'id'>) => agentRequest<{ success: boolean }>(`/mcp/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    createMcpServer: (data: { id: string } & Omit<McpServer, 'id'>) => agentRequest<{ success: boolean }>('/mcp', { method: 'POST', body: JSON.stringify(data) }),
    deleteMcpServer: (id: string) => agentRequest<{ success: boolean }>(`/mcp/${id}`, { method: 'DELETE' }),
    plugins: () => agentRequest<{ plugins: Plugin[] }>('/plugins'),
    plugin: (id: string) => agentRequest<{ plugin: Plugin }>(`/plugins/${id}`),
    pluginRaw: (id: string) => agentRequest<{ id: string; content: string }>(`/plugins/${id}/raw`),
    savePlugin: (id: string, data: Omit<Plugin, 'id'>) => agentRequest<{ success: boolean }>(`/plugins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    createPlugin: (data: { id: string } & Omit<Plugin, 'id'>) => agentRequest<{ success: boolean }>('/plugins', { method: 'POST', body: JSON.stringify(data) }),
    deletePlugin: (id: string) => agentRequest<{ success: boolean }>(`/plugins/${id}`, { method: 'DELETE' }),
    models: () => agentRequest<{ models: Array<{ id: string; name: string; tag: string; provider: string }>; defaultModel: string }>('/models'),
    modelsConfig: () => agentRequest<{ providers: Array<{ name: string; apiKey: string; apiUrl: string; models: Array<{ id: string; name: string; tag: string }> }>; defaultModel: string }>('/models/config'),
    saveModelsConfig: (config: any) => agentRequest<{ success: boolean }>('/models/config', { method: 'PUT', body: JSON.stringify(config) }),
    cronTasks: () => agentRequest<{ tasks: CronTask[] }>('/cron-tasks'),
    cronTask: (id: string) => agentRequest<{ task: CronTask }>(`/cron-tasks/${id}`),
    createCronTask: (data: { id: string; name: string; description?: string; schedule?: string; script?: string; scriptType?: 'bash' | 'python' | 'js' | 'none'; callAgent?: boolean; agentSkillId?: string; agentPrompt?: string }) =>
      agentRequest<{ success: boolean }>('/cron-tasks', { method: 'POST', body: JSON.stringify(data) }),
    updateCronTask: (id: string, data: Partial<CronTask>) =>
      agentRequest<{ success: boolean }>(`/cron-tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCronTask: (id: string) =>
      agentRequest<{ success: boolean }>(`/cron-tasks/${id}`, { method: 'DELETE' }),
    runCronTask: (id: string) =>
      agentRequest<{ success: boolean; output?: string; error?: string }>(`/cron-tasks/${id}/run`, { method: 'POST' }),
    tools: () => agentRequest<{ tools: ToolConfig[] }>('/tools'),
    tool: (name: string) => agentRequest<{ tool: ToolConfig }>(`/tools/${encodeURIComponent(name)}`),
    saveTool: (name: string, data: { enabled?: boolean; description?: string }) =>
      agentRequest<{ success: boolean }>(`/tools/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),
    tasks: (sessionId: string) => agentRequest<{ data: Array<{ id: string; content: string; status: string; blockedBy?: string[]; verified?: boolean }> }>(`/tasks/${sessionId}`),
  },
  chat: {
    sessions: () => request<{ data: Array<{ id: string; title: string; created_at: string; updated_at: string }> }>('/chat/sessions'),
    list: (sessionId: string) => request<{ data: Array<{ id: number; role: string; content: string; tool_call_id: string; tool_calls_json: string; created_at: string }> }>(`/chat/${sessionId}`),
    save: (sessionId: string, role: string, content: string) => request<{ success: boolean }>(`/chat/${sessionId}`, { method: 'POST', body: JSON.stringify({ role, content }) }),
    saveBatch: (sessionId: string, messages: Array<{ role: string; content: string }>) => request<{ success: boolean; count: number }>(`/chat/${sessionId}/batch`, { method: 'POST', body: JSON.stringify({ messages }) }),
  },
  orgs: {
    list: () => request<any[]>('/orgs'),
    tree: () => request<any[]>('/orgs/tree'),
    create: (data: any) => request<any>('/orgs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/orgs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/orgs/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: (params?: Record<string, string>) => request<PaginatedResponse<any>>(`/users?${new URLSearchParams(params).toString()}`),
    create: (data: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/users/${id}`, { method: 'DELETE' }),
    roles: (id: string) => request<any[]>(`/users/${id}/roles`),
    setRoles: (id: string, roleIds: string[]) => request<any>(`/users/${id}/roles`, { method: 'PUT', body: JSON.stringify({ roleIds }) }),
  },
  roles: {
    list: () => request<any[]>('/roles'),
    create: (data: any) => request<any>('/roles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<any>(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<any>(`/roles/${id}`, { method: 'DELETE' }),
    permissions: (id: string) => request<{ menus: string[]; operations: string[]; dataScopes: Record<string, string> }>(`/roles/${id}/permissions`),
    setPermissions: (id: string, data: any) => request<any>(`/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify(data) }),
    skillPermissions: (id: string) => request<{ skillIds: string[] }>(`/roles/${id}/skill-permissions`),
    setSkillPermissions: (id: string, skillIds: string[]) => request<any>(`/roles/${id}/skill-permissions`, { method: 'PUT', body: JSON.stringify({ skillIds }) }),
  },
  menus: {
    list: () => request<any[]>('/menus'),
  },
  operations: {
    list: () => request<any[]>('/operations'),
  },
  scopeFields: {
    list: () => request<any>('/scope-fields'),
  },
  claw: {
    get: () => request<{ content: string }>('/claw'),
    save: (content: string) => request<{ success: boolean }>('/claw', { method: 'PUT', body: JSON.stringify({ content }) }),
  },
  notifications: {
    channels: {
      list: () => request<{ data: any[] }>('/notification-channels'),
      get: (id: string) => request<{ data: any }>(`/notification-channels/${id}`),
      create: (data: { id: string; name: string; type: string; config?: Record<string, any> }) =>
        request<{ success: boolean }>('/notification-channels', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { name?: string; config?: Record<string, any>; enabled?: boolean; subagentId?: string | null }) =>
        request<{ success: boolean }>(`/notification-channels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) =>
        request<{ success: boolean }>(`/notification-channels/${id}`, { method: 'DELETE' }),
    },
    test: (channelId: string) =>
      request<{ success: boolean; detail?: string; error?: string }>(`/notifications/test/${channelId}`, { method: 'POST' }),
    send: (data: { channelId: string; to?: string; subject?: string; message: string; templateId?: string }) =>
      request<{ success: boolean; detail?: string; error?: string }>('/notifications/send', { method: 'POST', body: JSON.stringify(data) }),
    health: (channelId: string) =>
      request<{ status: string; lastTest: any }>(`/notification-channels/${channelId}/health`),
    templates: {
      list: () => request<{ data: any[] }>('/notification-templates'),
      get: (id: string) => request<{ data: any }>(`/notification-templates/${id}`),
      create: (data: { id: string; name: string; subject?: string; body?: string; variables?: any[] }) =>
        request<{ success: boolean }>('/notification-templates', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { name?: string; subject?: string; body?: string; variables?: any[] }) =>
        request<{ success: boolean }>(`/notification-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) =>
        request<{ success: boolean }>(`/notification-templates/${id}`, { method: 'DELETE' }),
    },
    logs: {
      list: (params?: { channelId?: string; success?: number; page?: number; pageSize?: number }) =>
        request<{ data: any[]; total: number; page: number; pageSize: number }>(`/notification-logs?${new URLSearchParams(Object.fromEntries(Object.entries(params || {}).filter(([_,v]) => v !== undefined).map(([k,v]) => [k, String(v)]))).toString()}`),
    },
  },
  subagents: {
    list: () => request<{ data: any[] }>('/subagents'),
    get: (id: string) => request<any>(`/subagents/${id}`),
    create: (data: { id: string; name: string; description?: string; system_prompt?: string; icon?: string; color?: string; enabled_skills?: string; enabled_tools?: string }) =>
      request<any>('/subagents', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; description?: string; system_prompt?: string; icon?: string; color?: string; enabled_skills?: string; enabled_tools?: string }) =>
      request<any>(`/subagents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/subagents/${id}`, { method: 'DELETE' }),
  },
}
