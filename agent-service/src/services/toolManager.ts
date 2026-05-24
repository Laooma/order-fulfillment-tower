import fs from 'fs'
import path from 'path'
import type { McpPool } from './mcpPool'

export interface ToolConfig {
  name: string
  description: string
  enabled: boolean
  source: 'built-in' | 'mcp'
  mcpServer?: string
  parameters?: Record<string, unknown>
}

interface ToolOverride {
  enabled?: boolean
  description?: string
}

const CONFIG_PATH = path.resolve(process.cwd(), '.claw', 'tools.json')

const BUILTIN_TOOLS: ToolConfig[] = [
  {
    name: 'todo_write',
    description: '创建和管理结构化任务列表，跟踪进度、组织复杂任务',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '任务唯一标识' },
              content: { type: 'string', description: '任务描述' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: '任务状态' },
            },
            required: ['id', 'content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'save_skill',
    description: '保存新的 Skill 到 skills 目录，Skill 将立即可用',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'Skill ID（不含 .md 的文件名）' },
        name: { type: 'string', description: 'Skill 显示名称' },
        description: { type: 'string', description: 'Skill 功能描述' },
        icon: { type: 'string', description: '图标名称' },
        color: { type: 'string', description: '颜色: ai-purple, ai-blue, ai-green, ai-orange' },
        prompt: { type: 'string', description: 'Skill 的 system prompt 正文（不含 YAML frontmatter）' },
      },
      required: ['skillId', 'name', 'description', 'icon', 'color', 'prompt'],
    },
  },
  {
    name: 'save_hook',
    description: '保存新的 Hook 到 hooks 目录，Hook 将立即可用',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        hookId: { type: 'string', description: 'Hook ID' },
        name: { type: 'string', description: '显示名称' },
        description: { type: 'string', description: '功能描述' },
        event: { type: 'string', enum: ['before_chat', 'after_chat', 'before_tool_call', 'after_tool_call', 'on_error'] },
        script: { type: 'string', description: '要执行的 shell 脚本' },
        enabled: { type: 'boolean' },
        matcher: { type: 'string', description: '匹配 tool/skill 名称的正则，* 匹配全部' },
      },
      required: ['hookId', 'name', 'description', 'event', 'script'],
    },
  },
  {
    name: 'send_notification',
    description: '通过已配置的通知渠道（邮件、企微、飞书）发送通知消息',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: '通知渠道 ID' },
        to: { type: 'string', description: '接收人（邮箱地址或留空使用 webhook 默认接收人）' },
        subject: { type: 'string', description: '消息主题（仅邮件）' },
        message: { type: 'string', description: '消息正文，企微机器人支持 markdown' },
      },
      required: ['channelId', 'message'],
    },
  },
  {
    name: 'list_notification_channels',
    description: '列出所有已配置的通知渠道（邮件、企微机器人、飞书机器人）',
    enabled: true,
    source: 'built-in',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'show_analysis_result',
    description: '在界面中展示可视化分析结果面板（A2UI）。仅当用户明确要求可视化输出时调用',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '分析结果页面标题' },
        a2uiMessages: { type: 'array', description: 'A2UI v0.9 消息数组', items: { type: 'object' } },
      },
      required: ['title', 'a2uiMessages'],
    },
  },
  {
    name: 'create_analysis_task',
    description: '创建分析任务记录，将分析结果持久化保存到历史分析页面',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '分析任务标题' },
        result: { type: 'object', description: '结构化分析结果（orders、problemCategories、deliveryTables）' },
      },
      required: ['title'],
    },
  },
  {
    name: 'fetch_biz_data',
    description: '获取业务合同/装置/包/物料的层级数据及齐套分析结果。支持按合同ID或包ID查询',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        contractId: { type: 'string', description: '合同ID，如 SC-2025-001' },
        packageId: { type: 'string', description: '包ID，如 PKG-0101-SC-2025-001' },
      },
      required: [],
    },
  },
  {
    name: 'generate_todos',
    description: '为已有的分析任务生成待办执行清单',
    enabled: true,
    source: 'built-in',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '分析任务 ID，由 create_analysis_task 返回' },
      },
      required: ['taskId'],
    },
  },
]

function loadOverrides(): Record<string, ToolOverride> {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch { /* ignore */ }
  return {}
}

function saveOverrides(overrides: Record<string, ToolOverride>): void {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(overrides, null, 2), 'utf-8')
}

export function getAllTools(mcpPool: McpPool): ToolConfig[] {
  const overrides = loadOverrides()

  // Apply overrides to built-in tools
  const builtin = BUILTIN_TOOLS.map((t) => {
    const override = overrides[t.name]
    if (override) {
      return {
        ...t,
        enabled: override.enabled ?? t.enabled,
        description: override.description ?? t.description,
      }
    }
    return t
  })

  // Get MCP tools
  const mcpTools: ToolConfig[] = mcpPool.getTools().map((t) => {
    const override = overrides[t.name]
    return {
      name: t.name,
      description: t.description || '',
      enabled: override?.enabled ?? true,
      source: 'mcp' as const,
      parameters: t.inputSchema,
    }
  })

  return [...builtin, ...mcpTools]
}

export function getEnabledTools(mcpPool: McpPool): ToolConfig[] {
  return getAllTools(mcpPool).filter((t) => t.enabled)
}

export function getToolConfig(name: string, mcpPool: McpPool): ToolConfig | null {
  return getAllTools(mcpPool).find((t) => t.name === name) || null
}

export function updateToolConfig(name: string, updates: ToolOverride): { success: boolean; error?: string } {
  const overrides = loadOverrides()
  const existing = overrides[name] || {}
  if (updates.enabled !== undefined) existing.enabled = updates.enabled
  if (updates.description !== undefined) existing.description = updates.description
  overrides[name] = existing
  saveOverrides(overrides)
  return { success: true }
}

export function getBuiltinToolNames(): string[] {
  return BUILTIN_TOOLS.map((t) => t.name)
}
