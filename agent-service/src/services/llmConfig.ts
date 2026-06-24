import fs from 'fs'
import path from 'path'

export interface LlmModel {
  id: string
  name: string
  tag: string
  deepThinking?: boolean
  contextWindow?: number
}

export interface LlmProviderConfig {
  name: string
  apiKey: string
  apiUrl: string
  models: LlmModel[]
}

interface LlmConfig {
  providers: LlmProviderConfig[]
  defaultModel: string
}

let cachedConfig: LlmConfig | null = null

export const CONFIG_PATH = path.resolve(process.cwd(), '.claw/llm.config.json')

function loadConfig(): LlmConfig {
  if (cachedConfig) return cachedConfig

  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn('[LlmConfig] .claw/llm.config.json not found, using empty config')
    cachedConfig = { providers: [], defaultModel: '' }
    return cachedConfig
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  cachedConfig = JSON.parse(raw) as LlmConfig
  console.log(`[LlmConfig] Loaded ${cachedConfig.providers.length} provider(s), default: ${cachedConfig.defaultModel}`)
  return cachedConfig
}

export function getProviderForModel(modelId: string): { apiKey: string; apiUrl: string } | null {
  const config = loadConfig()
  for (const provider of config.providers) {
    if (provider.models.some((m) => m.id === modelId)) {
      return { apiKey: provider.apiKey, apiUrl: provider.apiUrl }
    }
  }
  return null
}

export function getAllModels(): Array<LlmModel & { provider: string }> {
  const config = loadConfig()
  const models: Array<LlmModel & { provider: string }> = []
  for (const provider of config.providers) {
    for (const model of provider.models) {
      models.push({ ...model, provider: provider.name })
    }
  }
  return models
}

export function getDefaultModel(): string {
  const config = loadConfig()
  if (config.defaultModel) return config.defaultModel
  const first = config.providers[0]?.models[0]
  return first?.id || ''
}

export function getRawConfig(): LlmConfig {
  return loadConfig()
}

export function saveConfig(config: LlmConfig): void {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  cachedConfig = config
  console.log(`[LlmConfig] Saved ${config.providers.length} provider(s), default: ${config.defaultModel}`)
}
