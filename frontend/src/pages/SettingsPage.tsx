import { useState, useEffect, useCallback, useRef } from 'react'
import { Cpu, FileText, Building2, Users, Shield, Code2, Server, Puzzle, Clock, Bell, Wrench, Plus, Trash2, Edit3, Save, X, ChevronRight, ChevronDown, Play, ToggleLeft, ToggleRight, Mail, Send, MessageSquare, Pencil } from 'lucide-react'
import { api, type Skill, type Hook, type McpServer, type Plugin, type CronTask, type ToolConfig } from '../lib/api'
import MarkdownEditor from '../components/MarkdownEditor'
import { getSkillIcon, skillIconNames } from '../lib/skillIcons'
import { useAuthStore } from '../stores/authStore'
import ScriptEditor from '../components/ScriptEditor'

interface LlmModel {
  id: string
  name: string
  tag: string
  deepThinking?: boolean
  contextWindow?: number
}

interface LlmProvider {
  name: string
  apiKey: string
  apiUrl: string
  models: LlmModel[]
}

interface LlmConfig {
  providers: LlmProvider[]
  defaultModel: string
}

const allSettingsTabs = [
  { key: 'llm', label: '大模型接入点', icon: Cpu, menuId: 'menu_settings_llm' },
  { key: 'skills', label: 'Skill 管理', icon: FileText, menuId: 'menu_settings_skills' },
  { key: 'hooks', label: 'Hook 管理', icon: Code2, menuId: 'menu_settings_hooks' },
  { key: 'mcp', label: 'MCP 管理', icon: Server, menuId: 'menu_settings_mcp' },
  { key: 'plugins', label: '插件管理', icon: Puzzle, menuId: 'menu_settings_plugins' },
  { key: 'org', label: '组织机构', icon: Building2, menuId: 'menu_settings_org' },
  { key: 'users', label: '用户管理', icon: Users, menuId: 'menu_settings_users' },
  { key: 'roles', label: '角色与权限', icon: Shield, menuId: 'menu_settings_roles' },
  { key: 'cron-tasks', label: '定时任务', icon: Clock, menuId: 'menu_settings_cron' },
  { key: 'notifications', label: '通知管理', icon: Bell, menuId: 'menu_settings_notifications' },
  { key: 'tools', label: 'Tool 管理', icon: Wrench, menuId: 'menu_settings_tools' },
]

// Global refresh — callable from browser console or via chrome-devtools evaluate_script
function refreshSettings() {
  window.dispatchEvent(new CustomEvent('settings:refresh'))
}
window.__refreshSettings = refreshSettings

export default function SettingsPage() {
  const hasMenu = useAuthStore((s) => s.hasMenu)
  const isAdmin = useAuthStore((s) => s.isAdmin)
  const settingsMenu = allSettingsTabs.filter((tab) => isAdmin() || hasMenu(tab.menuId))
  const [activeKey, setActiveKey] = useState(settingsMenu[0]?.key || 'llm')

  const activeItem = settingsMenu.find((m) => m.key === activeKey)

  return (
    <div className="page-content">
      <div className="settings-layout">
        {/* Left sidebar */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-title">系统设置</div>
          <div className="settings-menu">
            {settingsMenu.map((item) => {
              const Icon = item.icon
              const isActive = item.key === activeKey
              return (
                <button
                  key={item.key}
                  className={`settings-menu-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveKey(item.key)}
                >
                  <Icon size={15} />
                  <span className="settings-menu-label">{item.label}</span>
                  <ChevronRight size={13} className="settings-menu-arrow" />
                </button>
              )
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="settings-panel">
          <div className="settings-panel-header">
            <h2 className="settings-panel-title">{activeItem?.label}</h2>
          </div>
          <div className="settings-panel-body">
            {activeKey === 'llm' && <LlmConfigPanel />}
            {activeKey === 'skills' && <SkillConfigPanel />}
            {activeKey === 'hooks' && <HookConfigPanel />}
            {activeKey === 'mcp' && <McpConfigPanel />}
            {activeKey === 'plugins' && <PluginConfigPanel />}
            {activeKey === 'org' && <OrgPanel />}
            {activeKey === 'users' && <UserPanel />}
            {activeKey === 'roles' && <RolePanel />}
            {activeKey === 'cron-tasks' && <CronTaskPanel />}
            {activeKey === 'notifications' && <NotificationPanel />}
            {activeKey === 'tools' && <ToolConfigPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── LLM Config Panel ── */
function LlmConfigPanel() {
  const [config, setConfig] = useState<LlmConfig>({ providers: [], defaultModel: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [expandedProviders, setExpandedProviders] = useState<Set<number>>(new Set())

  // Edit state
  const [editingProvider, setEditingProvider] = useState<{ index: number; data: LlmProvider } | null>(null)
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [editingModel, setEditingModel] = useState<{ providerIdx: number; modelIdx: number; data: LlmModel } | null>(null)
  const [showAddModel, setShowAddModel] = useState<number | null>(null)

  const [newProvider, setNewProvider] = useState<LlmProvider>({ name: '', apiKey: '', apiUrl: '', models: [] })
  const [newModel, setNewModel] = useState<LlmModel>({ id: '', name: '', tag: '', deepThinking: false, contextWindow: 128000 })

  const loadConfig = useCallback(() => {
    api.agent.modelsConfig()
      .then(setConfig)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    const handler = () => loadConfig()
    window.addEventListener('settings:refresh', handler)
    return () => window.removeEventListener('settings:refresh', handler)
  }, [loadConfig])

  const save = useCallback(async (cfg: LlmConfig) => {
    setSaving(true)
    setSaved(false)
    try {
      await api.agent.saveModelsConfig(cfg)
      setConfig(cfg)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Save failed:', err)
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [])

  const toggleExpand = (idx: number) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  // Provider CRUD
  const handleAddProvider = () => {
    if (!newProvider.name || !newProvider.apiUrl) return
    const updated = {
      ...config,
      providers: [...config.providers, newProvider],
      defaultModel: config.defaultModel || newProvider.models[0]?.id || '',
    }
    save(updated)
    setNewProvider({ name: '', apiKey: '', apiUrl: '', models: [] })
    setShowAddProvider(false)
  }

  const handleUpdateProvider = () => {
    if (!editingProvider) return
    const updated = { ...config }
    updated.providers = [...updated.providers]
    updated.providers[editingProvider.index] = editingProvider.data
    save(updated)
    setEditingProvider(null)
  }

  const handleDeleteProvider = (idx: number) => {
    const updated = { ...config }
    updated.providers = updated.providers.filter((_, i) => i !== idx)
    // Clear defaultModel if it belonged to deleted provider
    const deletedModels = config.providers[idx]?.models.map((m) => m.id) || []
    if (deletedModels.includes(updated.defaultModel)) {
      updated.defaultModel = updated.providers[0]?.models[0]?.id || ''
    }
    save(updated)
  }

  // Model CRUD
  const handleAddModel = (providerIdx: number) => {
    if (!newModel.id || !newModel.name) return
    const updated = { ...config }
    updated.providers = [...updated.providers]
    updated.providers[providerIdx] = {
      ...updated.providers[providerIdx],
      models: [...updated.providers[providerIdx].models, { ...newModel }],
    }
    save(updated)
    setNewModel({ id: '', name: '', tag: '', deepThinking: false, contextWindow: 128000 })
    setShowAddModel(null)
  }

  const handleUpdateModel = () => {
    if (!editingModel) return
    const updated = { ...config }
    updated.providers = [...updated.providers]
    updated.providers[editingModel.providerIdx] = { ...updated.providers[editingModel.providerIdx] }
    updated.providers[editingModel.providerIdx].models = [...updated.providers[editingModel.providerIdx].models]
    updated.providers[editingModel.providerIdx].models[editingModel.modelIdx] = editingModel.data
    // Update defaultModel if renamed
    const oldId = config.providers[editingModel.providerIdx].models[editingModel.modelIdx].id
    if (updated.defaultModel === oldId) {
      updated.defaultModel = editingModel.data.id
    }
    save(updated)
    setEditingModel(null)
  }

  const handleDeleteModel = (providerIdx: number, modelIdx: number) => {
    const updated = { ...config }
    const deletedId = updated.providers[providerIdx].models[modelIdx].id
    updated.providers = [...updated.providers]
    updated.providers[providerIdx] = {
      ...updated.providers[providerIdx],
      models: updated.providers[providerIdx].models.filter((_, i) => i !== modelIdx),
    }
    if (updated.defaultModel === deletedId) {
      updated.defaultModel = updated.providers[0]?.models[0]?.id || ''
    }
    save(updated)
  }

  if (loading) {
    return <div className="settings-empty"><p>加载中...</p></div>
  }

  return (
    <div className="llm-config">
      <div className="llm-config-toolbar">
        <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} onClick={() => setShowAddProvider(true)}>
          <Plus size={14} /> 添加供应商
        </button>
        {saved && <span style={{ color: 'var(--color-success)', fontSize: 12, fontWeight: 500 }}>已保存</span>}
      </div>

      {config.providers.length === 0 ? (
        <div className="settings-empty">
          <Cpu size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
          <p>暂无大模型接入点</p>
          <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>点击「添加供应商」开始配置</p>
        </div>
      ) : (
        <div className="llm-providers">
          {config.providers.map((provider, pIdx) => (
            <div key={pIdx} className="llm-provider-card">
              <div className="llm-provider-header" onClick={() => toggleExpand(pIdx)}>
                <span className="llm-provider-chevron">
                  {expandedProviders.has(pIdx) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="llm-provider-name">{provider.name}</span>
                <span className="llm-provider-url">{provider.apiUrl}</span>
                <span className="llm-provider-models-count">{provider.models.length} 个模型</span>
                <div className="llm-provider-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn-sm" title="编辑" onClick={() => setEditingProvider({ index: pIdx, data: { ...provider } })}>
                    <Edit3 size={12} />
                  </button>
                  <button className="icon-btn-sm danger" title="删除" onClick={() => handleDeleteProvider(pIdx)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {expandedProviders.has(pIdx) && (
                <div className="llm-models">
                  <div className="llm-models-header">
                    <span className="llm-models-title">模型列表</span>
                    <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }} onClick={() => { setShowAddModel(pIdx); setNewModel({ id: '', name: '', tag: '', deepThinking: false, contextWindow: 128000 }) }}>
                      <Plus size={12} /> 添加模型
                    </button>
                  </div>
                  {provider.models.length === 0 ? (
                    <div className="llm-models-empty">暂无模型</div>
                  ) : (
                    <div className="llm-models-list">
                      {provider.models.map((model, mIdx) => (
                        <div key={mIdx} className="llm-model-row">
                          <span className="llm-model-id">{model.id}</span>
                          <span className="llm-model-name">{model.name}</span>
                          <span className="llm-model-tag">{model.tag}</span>
                          {model.deepThinking && <span className="llm-model-reasoning-badge">深度思考</span>}
                          {model.contextWindow ? <span className="llm-model-context-badge">{model.contextWindow >= 1000 ? `${(model.contextWindow / 1000).toFixed(0)}k` : model.contextWindow}</span> : null}
                          {config.defaultModel === model.id && <span className="llm-model-default-badge">默认</span>}
                          <div className="llm-model-row-actions">
                            <button className="icon-btn-sm" title="编辑" onClick={() => setEditingModel({ providerIdx: pIdx, modelIdx: mIdx, data: { ...model } })}>
                              <Edit3 size={12} />
                            </button>
                            <button className="icon-btn-sm danger" title="删除" onClick={() => handleDeleteModel(pIdx, mIdx)}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Provider Modal */}
      {showAddProvider && (
        <Modal title="添加供应商" onClose={() => setShowAddProvider(false)}>
          <FormGroup label="供应商名称">
            <input className="settings-form-input" value={newProvider.name} onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })} placeholder="如：DeepSeek" />
          </FormGroup>
          <FormGroup label="API URL">
            <input className="settings-form-input" value={newProvider.apiUrl} onChange={(e) => setNewProvider({ ...newProvider, apiUrl: e.target.value })} placeholder="https://api.deepseek.com/v1/chat/completions" />
          </FormGroup>
          <FormGroup label="API Key">
            <input className="settings-form-input" type="password" value={newProvider.apiKey} onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })} placeholder="sk-..." />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowAddProvider(false)}>取消</button>
            <button className="btn btn-primary" onClick={handleAddProvider}>添加</button>
          </div>
        </Modal>
      )}

      {/* Edit Provider Modal */}
      {editingProvider && (
        <Modal title="编辑供应商" onClose={() => setEditingProvider(null)}>
          <FormGroup label="供应商名称">
            <input className="settings-form-input" value={editingProvider.data.name} onChange={(e) => setEditingProvider({ ...editingProvider, data: { ...editingProvider.data, name: e.target.value } })} />
          </FormGroup>
          <FormGroup label="API URL">
            <input className="settings-form-input" value={editingProvider.data.apiUrl} onChange={(e) => setEditingProvider({ ...editingProvider, data: { ...editingProvider.data, apiUrl: e.target.value } })} />
          </FormGroup>
          <FormGroup label="API Key">
            <input className="settings-form-input" type="password" value={editingProvider.data.apiKey} onChange={(e) => setEditingProvider({ ...editingProvider, data: { ...editingProvider.data, apiKey: e.target.value } })} />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setEditingProvider(null)}>取消</button>
            <button className="btn btn-primary" onClick={handleUpdateProvider}>保存</button>
          </div>
        </Modal>
      )}

      {/* Add Model Modal */}
      {showAddModel !== null && (
        <Modal title="添加模型" onClose={() => setShowAddModel(null)}>
          <FormGroup label="模型 ID">
            <input className="settings-form-input" value={newModel.id} onChange={(e) => setNewModel({ ...newModel, id: e.target.value })} placeholder="如：deepseek-chat" />
          </FormGroup>
          <FormGroup label="模型名称">
            <input className="settings-form-input" value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} placeholder="如：DeepSeek V3" />
          </FormGroup>
          <FormGroup label="标签（显示在模型选择器中）">
            <input className="settings-form-input" value={newModel.tag} onChange={(e) => setNewModel({ ...newModel, tag: e.target.value })} placeholder="如：DeepSeek" />
          </FormGroup>
          <FormGroup label="深度思考">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={newModel.deepThinking || false} onChange={(e) => setNewModel({ ...newModel, deepThinking: e.target.checked })} />
              <span className="settings-toggle-slider" />
              <span className="settings-toggle-label">开启后使用推理模型，响应更深入但耗时更长</span>
            </label>
          </FormGroup>
          <FormGroup label="上下文窗口大小（tokens）">
            <input className="settings-form-input" type="number" value={newModel.contextWindow || ''} onChange={(e) => setNewModel({ ...newModel, contextWindow: e.target.value ? Number(e.target.value) : undefined })} placeholder="如：128000" />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowAddModel(null)}>取消</button>
            <button className="btn btn-primary" onClick={() => handleAddModel(showAddModel)}>添加</button>
          </div>
        </Modal>
      )}

      {/* Edit Model Modal */}
      {editingModel && (
        <Modal title="编辑模型" onClose={() => setEditingModel(null)}>
          <FormGroup label="模型 ID">
            <input className="settings-form-input" value={editingModel.data.id} onChange={(e) => setEditingModel({ ...editingModel, data: { ...editingModel.data, id: e.target.value } })} />
          </FormGroup>
          <FormGroup label="模型名称">
            <input className="settings-form-input" value={editingModel.data.name} onChange={(e) => setEditingModel({ ...editingModel, data: { ...editingModel.data, name: e.target.value } })} />
          </FormGroup>
          <FormGroup label="标签">
            <input className="settings-form-input" value={editingModel.data.tag} onChange={(e) => setEditingModel({ ...editingModel, data: { ...editingModel.data, tag: e.target.value } })} />
          </FormGroup>
          <FormGroup label="深度思考">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={editingModel.data.deepThinking || false} onChange={(e) => setEditingModel({ ...editingModel, data: { ...editingModel.data, deepThinking: e.target.checked } })} />
              <span className="settings-toggle-slider" />
              <span className="settings-toggle-label">开启后使用推理模型，响应更深入但耗时更长</span>
            </label>
          </FormGroup>
          <FormGroup label="上下文窗口大小（tokens）">
            <input className="settings-form-input" type="number" value={editingModel.data.contextWindow || ''} onChange={(e) => setEditingModel({ ...editingModel, data: { ...editingModel.data, contextWindow: e.target.value ? Number(e.target.value) : undefined } })} placeholder="如：128000" />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setEditingModel(null)}>取消</button>
            <button className="btn btn-primary" onClick={handleUpdateModel}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── Skill Config Panel ── */
function SkillConfigPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [skillFull, setSkillFull] = useState<Skill | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['references', 'scripts']))
  const [activeFile, setActiveFile] = useState<string>('SKILL.md')  // 'SKILL.md' | 'references/xxx.md' | 'scripts/xxx.sh'
  const [editorContent, setEditorContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateFile, setShowCreateFile] = useState<{ type: 'reference' | 'script'; parentPath: string } | null>(null)
  const [createForm, setCreateForm] = useState({ id: '', name: '', description: '', icon: 'clipboard-check', color: 'ai-purple' })
  const [createFileForm, setCreateFileForm] = useState({ name: '', content: '' })

  const loadSkills = useCallback(() => {
    api.agent.skills()
      .then((res) => setSkills(res.skills))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  useEffect(() => {
    const handler = () => loadSkills()
    window.addEventListener('settings:refresh', handler)
    return () => window.removeEventListener('settings:refresh', handler)
  }, [loadSkills])

  const selectSkill = async (skillId: string) => {
    setSelectedSkillId(skillId)
    setActiveFile('SKILL.md')
    try {
      const res = await api.agent.skillFull(skillId)
      const s = res.skill
      setSkillFull(s)
      setEditorContent(s.prompt || '')
      setOriginalContent(s.prompt || '')
    } catch {
      setSkillFull(null)
      setEditorContent('')
      setOriginalContent('')
    }
  }

  const selectFile = async (filePath: string) => {
    if (!selectedSkillId) return
    setActiveFile(filePath)
    if (filePath === 'SKILL.md') {
      setEditorContent(skillFull?.prompt || '')
      setOriginalContent(skillFull?.prompt || '')
      return
    }
    try {
      const res = await api.agent.skillFile(selectedSkillId, filePath)
      setEditorContent(res.data.content)
      setOriginalContent(res.data.content)
    } catch {
      setEditorContent('')
      setOriginalContent('')
    }
  }

  const handleSave = async () => {
    if (!selectedSkillId) return
    setSaving(true)
    setSaved(false)
    try {
      if (activeFile === 'SKILL.md') {
        await api.agent.saveSkill(selectedSkillId, editorContent)
      } else {
        await api.agent.saveSkillFile(selectedSkillId, activeFile, editorContent)
      }
      setOriginalContent(editorContent)
      // Reload skill to update file list
      const res = await api.agent.skillFull(selectedSkillId)
      setSkillFull(res.skill)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreateFile = async () => {
    if (!selectedSkillId || !showCreateFile) return
    const prefix = showCreateFile.type === 'reference' ? 'references/' : 'scripts/'
    const filePath = prefix + createFileForm.name
    try {
      await api.agent.saveSkillFile(selectedSkillId, filePath, createFileForm.content || `# ${createFileForm.name}\n`)
      setShowCreateFile(null)
      setCreateFileForm({ name: '', content: '' })
      // Reload skill
      const res = await api.agent.skillFull(selectedSkillId)
      setSkillFull(res.skill)
      selectFile(filePath)
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  const handleDeleteFile = async (filePath: string) => {
    if (!selectedSkillId) return
    if (!confirm(`确定要删除 "${filePath}"？`)) return
    try {
      await api.agent.deleteSkillFile(selectedSkillId, filePath)
      if (activeFile === filePath) {
        setActiveFile('SKILL.md')
        setEditorContent(skillFull?.prompt || '')
        setOriginalContent(skillFull?.prompt || '')
      }
      const res = await api.agent.skillFull(selectedSkillId)
      setSkillFull(res.skill)
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const handleCreate = async () => {
    if (!createForm.id || !createForm.name) return
    try {
      await api.agent.createSkill({
        ...createForm,
        content: `# ${createForm.name}\n\n在此编写 Skill 的 Prompt 内容...`,
      })
      setShowCreate(false)
      setCreateForm({ id: '', name: '', description: '', icon: 'clipboard-check', color: 'ai-purple' })
      loadSkills()
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除 Skill "${id}"？`)) return
    try {
      await api.agent.deleteSkill(id)
      if (selectedSkillId === id) {
        setSelectedSkillId(null)
        setSkillFull(null)
        setEditorContent('')
      }
      loadSkills()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const isModified = editorContent !== originalContent

  // Get file list for tree view
  const getFileTree = () => {
    if (!skillFull) return []
    const items: Array<{ path: string; name: string; type: 'file' | 'folder'; icon?: string }> = []

    if (skillFull.references && skillFull.references.length > 0) {
      items.push({ path: 'references', name: 'references/', type: 'folder' })
      if (expandedFolders.has('references')) {
        for (const ref of skillFull.references) {
          items.push({ path: ref.id, name: ref.name, type: 'file', icon: 'ref' })
        }
      }
    }

    if (skillFull.scripts && skillFull.scripts.length > 0) {
      items.push({ path: 'scripts', name: 'scripts/', type: 'folder' })
      if (expandedFolders.has('scripts')) {
        for (const sc of skillFull.scripts) {
          items.push({ path: sc.id, name: sc.name, type: 'file', icon: 'script' })
        }
      }
    }

    if (skillFull.templates && skillFull.templates.length > 0 && expandedFolders.has('scripts')) {
      for (const tp of skillFull.templates) {
        items.push({ path: tp.id, name: tp.name, type: 'file', icon: 'template' })
      }
    }

    return items
  }

  // Get file extension for code highlighting hints
  const getFileLang = (name: string): string => {
    if (name.endsWith('.sh') || name.endsWith('.bash')) return 'shell'
    if (name.endsWith('.py')) return 'python'
    if (name.endsWith('.js') || name.endsWith('.ts')) return 'javascript'
    if (name.endsWith('.json')) return 'json'
    return 'markdown'
  }

  if (loading) {
    return <div className="settings-empty"><p>加载中...</p></div>
  }

  const fileTree = getFileTree()

  return (
    <div className="skill-config">
      {/* Left: Skill list + file tree */}
      <div className="skill-sidebar">
        <div className="skill-sidebar-header">
          <span className="skill-sidebar-title">Skills</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => setShowCreate(true)}>
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="skill-list">
          {skills.map((s) => (
            <div key={s.id}>
              <div
                className={`skill-list-item ${selectedSkillId === s.id ? 'active' : ''}`}
                onClick={() => selectSkill(s.id)}
              >
                <span className={`skill-list-icon ${s.color}`}>
                  {(() => { const Icon = getSkillIcon(s.icon); return <Icon size={11} strokeWidth={2.5} />; })()}
                </span>
                <div className="skill-list-body">
                  <div className="skill-list-name">{s.name}</div>
                  <div className="skill-list-id">{s.id}</div>
                </div>
                <button
                  className="icon-btn-sm danger"
                  title="删除"
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {/* File tree under selected skill */}
              {selectedSkillId === s.id && fileTree.length > 0 && (
                <div className="skill-tree">
                  {/* SKILL.md entry */}
                  <div
                    className={`skill-tree-item file ${activeFile === 'SKILL.md' ? 'active' : ''}`}
                    onClick={() => selectFile('SKILL.md')}
                  >
                    <FileText size={11} className="skill-tree-icon file" />
                    <span className="skill-tree-name">SKILL.md</span>
                  </div>
                  {/* References and Scripts */}
                  {fileTree.map((item) => (
                    <div key={item.path}>
                      {item.type === 'folder' ? (
                        <div className="skill-tree-item folder" onClick={() => toggleFolder(item.path)}>
                          {expandedFolders.has(item.path) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          <span className="skill-tree-name">{item.name}</span>
                          <button
                            className="icon-btn-sm"
                            title={`新建${item.path === 'references' ? '参考文档' : '脚本'}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setShowCreateFile({ type: item.path === 'references' ? 'reference' : 'script', parentPath: item.path })
                              setCreateFileForm({ name: '', content: '' })
                            }}
                            style={{ marginLeft: 'auto', height: 18, width: 18 }}
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`skill-tree-item file sub ${activeFile === item.path ? 'active' : ''}`}
                          onClick={() => selectFile(item.path)}
                        >
                          <FileText size={10} className="skill-tree-icon file" />
                          <span className="skill-tree-name">{item.name}</span>
                          <button
                            className="icon-btn-sm danger"
                            title="删除"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(item.path) }}
                            style={{ marginLeft: 'auto', height: 16, width: 16 }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Add reference / script buttons when no files exist yet */}
                  {(!skillFull?.references || skillFull.references.length === 0) && (
                    <div
                      className="skill-tree-item folder"
                      onClick={() => {
                        toggleFolder('references')
                        setShowCreateFile({ type: 'reference', parentPath: 'references' })
                        setCreateFileForm({ name: '', content: '' })
                      }}
                    >
                      <ChevronRight size={10} />
                      <span className="skill-tree-name" style={{ opacity: 0.5 }}>references/</span>
                      <Plus size={10} style={{ marginLeft: 'auto', opacity: 0.4 }} />
                    </div>
                  )}
                  {(!skillFull?.scripts || skillFull.scripts.length === 0) && (
                    <div
                      className="skill-tree-item folder"
                      onClick={() => {
                        toggleFolder('scripts')
                        setShowCreateFile({ type: 'script', parentPath: 'scripts' })
                        setCreateFileForm({ name: '', content: '' })
                      }}
                    >
                      <ChevronRight size={10} />
                      <span className="skill-tree-name" style={{ opacity: 0.5 }}>scripts/</span>
                      <Plus size={10} style={{ marginLeft: 'auto', opacity: 0.4 }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {skills.length === 0 && (
            <div className="skill-list-empty">暂无 Skill，点击「新建」创建</div>
          )}
        </div>
      </div>

      {/* Right: Editor */}
      <div className="skill-editor">
        {skillFull ? (
          <>
            <div className="skill-editor-header">
              <span className="skill-editor-title">
                <span className={`skill-list-icon ${skillFull.color}`}>
                  {(() => { const Icon = getSkillIcon(skillFull.icon); return <Icon size={12} strokeWidth={2.5} />; })()}
                </span>
                {skillFull.name}
                <span className="skill-editor-filename">{activeFile}</span>
                {getFileLang(activeFile) !== 'markdown' && (
                  <span className="skill-editor-file-lang">{getFileLang(activeFile)}</span>
                )}
              </span>
              <div className="skill-editor-actions">
                {isModified && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>已修改</span>}
                {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                <button className="btn btn-primary" style={{ height: 28, fontSize: 11 }} onClick={handleSave} disabled={saving || !isModified}>
                  <Save size={12} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
            {/* Tabs */}
            <div className="skill-tabs">
              <button
                className={`skill-tab ${activeFile === 'SKILL.md' ? 'active' : ''}`}
                onClick={() => selectFile('SKILL.md')}
              >
                SKILL.md
              </button>
              {skillFull.references?.map((ref) => (
                <button
                  key={ref.id}
                  className={`skill-tab ${activeFile === ref.id ? 'active' : ''}`}
                  onClick={() => selectFile(ref.id)}
                >
                  {ref.name}
                  <span
                    className="skill-tab-close"
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(ref.id) }}
                    title="删除"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
              {skillFull.scripts?.map((sc) => (
                <button
                  key={sc.id}
                  className={`skill-tab ${activeFile === sc.id ? 'active' : ''}`}
                  onClick={() => selectFile(sc.id)}
                >
                  {sc.name}
                  <span
                    className="skill-tab-close"
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(sc.id) }}
                    title="删除"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
              {skillFull.templates?.map((tp) => (
                <button
                  key={tp.id}
                  className={`skill-tab ${activeFile === tp.id ? 'active' : ''}`}
                  onClick={() => selectFile(tp.id)}
                >
                  {tp.name}
                  <span
                    className="skill-tab-close"
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(tp.id) }}
                    title="删除"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
              <button
                className="skill-tab skill-tab-add"
                onClick={() => setShowCreateFile({ type: 'reference', parentPath: 'references' })}
                title="新建文件"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="skill-editor-body">
              <MarkdownEditor
                value={editorContent}
                onChange={setEditorContent}
              />
            </div>
          </>
        ) : (
          <div className="settings-empty">
            <FileText size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p>选择左侧 Skill 开始编辑</p>
          </div>
        )}
      </div>

      {/* Create Skill Modal */}
      {showCreate && (
        <Modal title="新建 Skill" onClose={() => setShowCreate(false)}>
          <FormGroup label="Skill ID（目录名）">
            <input className="settings-form-input" value={createForm.id} onChange={(e) => setCreateForm({ ...createForm, id: e.target.value })} placeholder="如：my-agent" />
          </FormGroup>
          <FormGroup label="名称">
            <input className="settings-form-input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="如：我的智能体" />
          </FormGroup>
          <FormGroup label="描述">
            <input className="settings-form-input" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="简要描述该 Skill 的功能" />
          </FormGroup>
          <FormGroup label="图标">
            <select className="settings-form-input" value={createForm.icon} onChange={(e) => setCreateForm({ ...createForm, icon: e.target.value })}>
              {skillIconNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </FormGroup>
          <FormGroup label="颜色类名">
            <select className="settings-form-input" value={createForm.color} onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })}>
              <option value="ai-purple">紫色</option>
              <option value="ai-blue">蓝色</option>
              <option value="ai-green">绿色</option>
              <option value="ai-orange">橙色</option>
            </select>
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
            <button className="btn btn-primary" onClick={handleCreate}>创建</button>
          </div>
        </Modal>
      )}

      {/* Create File Modal */}
      {showCreateFile && (
        <Modal
          title={`新建${showCreateFile.type === 'reference' ? '参考文档' : '脚本'}`}
          onClose={() => setShowCreateFile(null)}
        >
          <FormGroup label="文件名">
            <input
              className="settings-form-input"
              value={createFileForm.name}
              onChange={(e) => setCreateFileForm({ ...createFileForm, name: e.target.value })}
              placeholder={showCreateFile.type === 'reference' ? '如：api-guide.md' : '如：helper.sh'}
            />
          </FormGroup>
          <FormGroup label="初始内容">
            <textarea
              className="settings-form-input"
              rows={6}
              value={createFileForm.content}
              onChange={(e) => setCreateFileForm({ ...createFileForm, content: e.target.value })}
              placeholder={showCreateFile.type === 'reference' ? '# 参考文档\n\n...' : '#!/bin/bash\n\n# 脚本内容...'}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowCreateFile(null)}>取消</button>
            <button className="btn btn-primary" onClick={handleCreateFile}>创建</button>
          </div>
        </Modal>
      )}
    </div>
  )
}


/* ── Hook Config Panel ── */
function HookConfigPanel() {
  const [hooks, setHooks] = useState<Hook[]>([])
  const [selectedHook, setSelectedHook] = useState<Hook | null>(null)
  const [editorData, setEditorData] = useState<{ name: string; description: string; event: string; script: string; enabled: boolean; matcher: string }>({ name: '', description: '', event: 'before_chat', script: '', enabled: true, matcher: '*' })
  const [originalData, setOriginalData] = useState<typeof editorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ id: '', name: '', description: '', event: 'before_chat', script: '#!/bin/bash\necho "hook executed"', enabled: true, matcher: '*' })

  const loadHooks = useCallback(() => {
    api.agent.hooks()
      .then((res) => setHooks(res.hooks))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadHooks()
  }, [loadHooks])

  useEffect(() => {
    const handler = () => loadHooks()
    window.addEventListener('settings:refresh', handler)
    return () => window.removeEventListener('settings:refresh', handler)
  }, [loadHooks])

  const selectHook = async (hook: Hook) => {
    setSelectedHook(hook)
    try {
      const res = await api.agent.hookRaw(hook.id)
      const parsed = JSON.parse(res.content)
      const ed = {
        name: parsed.name || hook.name,
        description: parsed.description || hook.description,
        event: parsed.event || hook.event,
        script: parsed.script || '',
        enabled: parsed.enabled !== false,
        matcher: parsed.matcher || '*',
      }
      setEditorData(ed)
      setOriginalData({ ...ed })
    } catch {
      setEditorData({ name: hook.name, description: hook.description, event: hook.event, script: '', enabled: hook.enabled, matcher: hook.matcher })
      setOriginalData(null)
    }
  }

  const handleSave = async () => {
    if (!selectedHook) return
    setSaving(true)
    setSaved(false)
    try {
      await api.agent.saveHook(selectedHook.id, editorData)
      setOriginalData({ ...editorData })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      loadHooks()
    } catch (err) {
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!createForm.id || !createForm.name) {
      alert('请填写 Hook ID 和名称')
      return
    }
    try {
      await api.agent.createHook(createForm)
      setShowCreate(false)
      setCreateForm({ id: '', name: '', description: '', event: 'before_chat', script: '#!/bin/bash\necho "hook executed"', enabled: true, matcher: '*' })
      loadHooks()
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除 Hook "${id}"？`)) return
    try {
      await api.agent.deleteHook(id)
      if (selectedHook?.id === id) {
        setSelectedHook(null)
        setEditorData({ name: '', description: '', event: 'before_chat', script: '', enabled: true, matcher: '*' })
        setOriginalData(null)
      }
      loadHooks()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const isModified = originalData && (
    editorData.name !== originalData.name ||
    editorData.description !== originalData.description ||
    editorData.event !== originalData.event ||
    editorData.script !== originalData.script ||
    editorData.enabled !== originalData.enabled ||
    editorData.matcher !== originalData.matcher
  )

  const eventLabels: Record<string, string> = {
    before_chat: '对话前',
    after_chat: '对话后',
    before_tool_call: '工具调用前',
    after_tool_call: '工具调用后',
    on_error: '错误时',
  }

  if (loading) {
    return <div className="settings-empty"><p>加载中...</p></div>
  }

  return (
    <div className="skill-config">
      <div className="skill-sidebar">
        <div className="skill-sidebar-header">
          <span className="skill-sidebar-title">Hooks</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => setShowCreate(true)}>
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="skill-list">
          {hooks.map((h) => (
            <div
              key={h.id}
              className={`skill-list-item ${selectedHook?.id === h.id ? 'active' : ''}`}
              onClick={() => selectHook(h)}
            >
              <span className={`skill-list-icon ${h.enabled ? 'ai-green' : 'ai-orange'}`}>
                <Code2 size={11} strokeWidth={2.5} />
              </span>
              <div className="skill-list-body">
                <div className="skill-list-name">{h.name}</div>
                <div className="skill-list-id">
                  <span className="hook-event-badge">{eventLabels[h.event] || h.event}</span>
                  {!h.enabled && <span className="hook-disabled-badge">已禁用</span>}
                </div>
              </div>
              <button
                className="icon-btn-sm danger"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(h.id)
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {hooks.length === 0 && (
            <div className="skill-list-empty">暂无 Hook，点击「新建」创建</div>
          )}
        </div>
      </div>

      <div className="skill-editor">
        {selectedHook ? (
          <>
            <div className="skill-editor-header">
              <span className="skill-editor-title">
                <span className={`skill-list-icon ${editorData.enabled ? 'ai-green' : 'ai-orange'}`}>
                  <Code2 size={12} strokeWidth={2.5} />
                </span>
                {selectedHook.name}
                <span className="skill-editor-filename">{selectedHook.id}.json</span>
              </span>
              <div className="skill-editor-actions">
                {isModified && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>已修改</span>}
                {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                <button className="btn btn-primary" style={{ height: 28, fontSize: 11 }} onClick={handleSave} disabled={saving || !isModified}>
                  <Save size={12} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
            <div className="hook-editor-body">
              <FormGroup label="名称">
                <input className="settings-form-input" value={editorData.name} onChange={(e) => setEditorData({ ...editorData, name: e.target.value })} />
              </FormGroup>
              <FormGroup label="描述">
                <input className="settings-form-input" value={editorData.description} onChange={(e) => setEditorData({ ...editorData, description: e.target.value })} />
              </FormGroup>
              <FormGroup label="触发事件">
                <select className="settings-form-input" value={editorData.event} onChange={(e) => setEditorData({ ...editorData, event: e.target.value })}>
                  <option value="before_chat">before_chat — 对话前</option>
                  <option value="after_chat">after_chat — 对话后</option>
                  <option value="before_tool_call">before_tool_call — 工具调用前</option>
                  <option value="after_tool_call">after_tool_call — 工具调用后</option>
                  <option value="on_error">on_error — 发生错误时</option>
                </select>
              </FormGroup>
              <FormGroup label="Matcher（匹配规则，* 匹配所有）">
                <input className="settings-form-input" value={editorData.matcher} onChange={(e) => setEditorData({ ...editorData, matcher: e.target.value })} placeholder="* 或工具名/智能体名的正则" />
              </FormGroup>
              <FormGroup label="启用">
                <label className="settings-toggle-wrap">
                  <input type="checkbox" checked={editorData.enabled} onChange={(e) => setEditorData({ ...editorData, enabled: e.target.checked })} />
                  <span className="settings-toggle-slider" />
                  <span className="settings-toggle-label">启用后该 Hook 将在对应事件触发时执行</span>
                </label>
              </FormGroup>
              <FormGroup label="脚本内容">
                <ScriptEditor
                  value={editorData.script}
                  onChange={(v) => setEditorData({ ...editorData, script: v })}
                  language="bash"
                  minHeight="400px"
                />
              </FormGroup>
            </div>
          </>
        ) : (
          <div className="settings-empty">
            <Code2 size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p>选择左侧 Hook 开始编辑</p>
          </div>
        )}
      </div>

      {/* Create Hook Modal */}
      {showCreate && (
        <Modal title="新建 Hook" onClose={() => setShowCreate(false)}>
          <FormGroup label="Hook ID（文件名，不含 .json）">
            <input className="settings-form-input" value={createForm.id} onChange={(e) => setCreateForm({ ...createForm, id: e.target.value })} placeholder="如：log-chat" />
          </FormGroup>
          <FormGroup label="名称">
            <input className="settings-form-input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="如：聊天日志" />
          </FormGroup>
          <FormGroup label="描述">
            <input className="settings-form-input" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="简要描述该 Hook 的功能" />
          </FormGroup>
          <FormGroup label="触发事件">
            <select className="settings-form-input" value={createForm.event} onChange={(e) => setCreateForm({ ...createForm, event: e.target.value })}>
              <option value="before_chat">before_chat — 对话前</option>
              <option value="after_chat">after_chat — 对话后</option>
              <option value="before_tool_call">before_tool_call — 工具调用前</option>
              <option value="after_tool_call">after_tool_call — 工具调用后</option>
              <option value="on_error">on_error — 发生错误时</option>
            </select>
          </FormGroup>
          <FormGroup label="Matcher（匹配规则，* 匹配所有）">
            <input className="settings-form-input" value={createForm.matcher} onChange={(e) => setCreateForm({ ...createForm, matcher: e.target.value })} placeholder="*" />
          </FormGroup>
          <FormGroup label="启用">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={createForm.enabled} onChange={(e) => setCreateForm({ ...createForm, enabled: e.target.checked })} />
              <span className="settings-toggle-slider" />
            </label>
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
            <button className="btn btn-primary" onClick={handleCreate}>创建</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── MCP Config Panel ── */
function McpConfigPanel() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null)
  const [editorData, setEditorData] = useState<{ name: string; description: string; command: string; args: string; env: string; enabled: boolean; autoConnect: boolean }>({ name: '', description: '', command: '', args: '', env: '', enabled: true, autoConnect: true })
  const [originalData, setOriginalData] = useState<typeof editorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ id: '', name: '', description: '', command: 'npx', args: '', env: '', enabled: true, autoConnect: true })

  const loadServers = useCallback(() => {
    api.agent.mcpServers()
      .then((res) => setServers(res.servers))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  useEffect(() => {
    const handler = () => loadServers()
    window.addEventListener('settings:refresh', handler)
    return () => window.removeEventListener('settings:refresh', handler)
  }, [loadServers])

  const selectServer = async (server: McpServer) => {
    setSelectedServer(server)
    try {
      const res = await api.agent.mcpServerRaw(server.id)
      const parsed = JSON.parse(res.content)
      const ed = {
        name: parsed.name || server.name,
        description: parsed.description || server.description || '',
        command: parsed.command || server.command || '',
        args: (parsed.args || []).join('\n'),
        env: parsed.env ? JSON.stringify(parsed.env, null, 2) : '{}',
        enabled: parsed.enabled !== false,
        autoConnect: parsed.autoConnect !== false,
      }
      setEditorData(ed)
      setOriginalData({ ...ed })
    } catch {
      setEditorData({ name: server.name, description: server.description || '', command: server.command, args: (server.args || []).join('\n'), env: JSON.stringify(server.env || {}, null, 2), enabled: server.enabled, autoConnect: server.autoConnect })
      setOriginalData(null)
    }
  }

  const handleSave = async () => {
    if (!selectedServer) return
    setSaving(true)
    setSaved(false)
    try {
      const data = {
        name: editorData.name,
        description: editorData.description,
        command: editorData.command,
        args: editorData.args.split('\n').filter((a: string) => a.trim()),
        env: JSON.parse(editorData.env || '{}'),
        enabled: editorData.enabled,
        autoConnect: editorData.autoConnect,
      }
      await api.agent.saveMcpServer(selectedServer.id, data)
      setOriginalData({ ...editorData })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      loadServers()
    } catch (err) {
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!createForm.id || !createForm.name || !createForm.command) {
      alert('请填写 MCP 服务器 ID、名称和启动命令')
      return
    }
    try {
      const data = {
        name: createForm.name,
        description: createForm.description,
        command: createForm.command,
        args: createForm.args.split('\n').filter((a: string) => a.trim()),
        env: createForm.env ? JSON.parse(createForm.env) : {},
        enabled: createForm.enabled,
        autoConnect: createForm.autoConnect,
      }
      await api.agent.createMcpServer({ id: createForm.id, ...data })
      setShowCreate(false)
      setCreateForm({ id: '', name: '', description: '', command: 'npx', args: '', env: '', enabled: true, autoConnect: true })
      loadServers()
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除 MCP 服务器 "${id}"？`)) return
    try {
      await api.agent.deleteMcpServer(id)
      if (selectedServer?.id === id) {
        setSelectedServer(null)
        setEditorData({ name: '', description: '', command: '', args: '', env: '', enabled: true, autoConnect: true })
        setOriginalData(null)
      }
      loadServers()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const isModified = originalData && (
    editorData.name !== originalData.name ||
    editorData.description !== originalData.description ||
    editorData.command !== originalData.command ||
    editorData.args !== originalData.args ||
    editorData.env !== originalData.env ||
    editorData.enabled !== originalData.enabled ||
    editorData.autoConnect !== originalData.autoConnect
  )

  if (loading) return <div className="settings-empty"><p>加载中...</p></div>

  return (
    <div className="skill-config">
      <div className="skill-sidebar">
        <div className="skill-sidebar-header">
          <span className="skill-sidebar-title">MCP 服务器</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => setShowCreate(true)}>
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="skill-list">
          {servers.map((s) => (
            <div
              key={s.id}
              className={`skill-list-item ${selectedServer?.id === s.id ? 'active' : ''}`}
              onClick={() => selectServer(s)}
            >
              <span className={`skill-list-icon ${s.enabled ? 'ai-blue' : 'ai-orange'}`}>
                <Server size={11} strokeWidth={2.5} />
              </span>
              <div className="skill-list-body">
                <div className="skill-list-name">{s.name}</div>
                <div className="skill-list-id">
                  <span className="hook-event-badge">{s.command}</span>
                  {s.autoConnect && <span className="hook-event-badge" style={{ background: 'oklch(92% 0.04 150)', color: 'oklch(40% 0.12 150)' }}>自动连接</span>}
                  {!s.enabled && <span className="hook-disabled-badge">已禁用</span>}
                </div>
              </div>
              <button className="icon-btn-sm danger" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {servers.length === 0 && <div className="skill-list-empty">暂无 MCP 服务器，点击「新建」添加</div>}
        </div>
      </div>

      <div className="skill-editor">
        {selectedServer ? (
          <>
            <div className="skill-editor-header">
              <span className="skill-editor-title">
                <span className={`skill-list-icon ${editorData.enabled ? 'ai-blue' : 'ai-orange'}`}>
                  <Server size={12} strokeWidth={2.5} />
                </span>
                {selectedServer.name}
                <span className="skill-editor-filename">{selectedServer.id}.json</span>
              </span>
              <div className="skill-editor-actions">
                {isModified && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>已修改</span>}
                {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                <button className="btn btn-primary" style={{ height: 28, fontSize: 11 }} onClick={handleSave} disabled={saving || !isModified}>
                  <Save size={12} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
            <div className="hook-editor-body">
              <FormGroup label="名称">
                <input className="settings-form-input" value={editorData.name} onChange={(e) => setEditorData({ ...editorData, name: e.target.value })} />
              </FormGroup>
              <FormGroup label="描述">
                <input className="settings-form-input" value={editorData.description} onChange={(e) => setEditorData({ ...editorData, description: e.target.value })} />
              </FormGroup>
              <FormGroup label="启动命令">
                <input className="settings-form-input" value={editorData.command} onChange={(e) => setEditorData({ ...editorData, command: e.target.value })} placeholder="如：npx, node, python" />
              </FormGroup>
              <FormGroup label="启动参数（每行一个）">
                <textarea className="hook-script-editor" style={{ minHeight: 80 }} value={editorData.args} onChange={(e) => setEditorData({ ...editorData, args: e.target.value })} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"} />
              </FormGroup>
              <FormGroup label="环境变量（JSON 格式）">
                <textarea className="hook-script-editor" style={{ minHeight: 60 }} value={editorData.env} onChange={(e) => setEditorData({ ...editorData, env: e.target.value })} placeholder='{"KEY": "value"}' />
              </FormGroup>
              <FormGroup label="启用">
                <label className="settings-toggle-wrap">
                  <input type="checkbox" checked={editorData.enabled} onChange={(e) => setEditorData({ ...editorData, enabled: e.target.checked })} />
                  <span className="settings-toggle-slider" />
                  <span className="settings-toggle-label">启用后该服务器将在系统启动时加载</span>
                </label>
              </FormGroup>
              <FormGroup label="自动连接">
                <label className="settings-toggle-wrap">
                  <input type="checkbox" checked={editorData.autoConnect} onChange={(e) => setEditorData({ ...editorData, autoConnect: e.target.checked })} />
                  <span className="settings-toggle-slider" />
                  <span className="settings-toggle-label">启动时自动建立 MCP 连接</span>
                </label>
              </FormGroup>
            </div>
          </>
        ) : (
          <div className="settings-empty">
            <Server size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p>选择左侧 MCP 服务器查看配置</p>
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="新建 MCP 服务器" onClose={() => setShowCreate(false)}>
          <FormGroup label="服务器 ID（文件名）">
            <input className="settings-form-input" value={createForm.id} onChange={(e) => setCreateForm({ ...createForm, id: e.target.value })} placeholder="如：filesystem-server" />
          </FormGroup>
          <FormGroup label="名称">
            <input className="settings-form-input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="如：文件系统 MCP" />
          </FormGroup>
          <FormGroup label="描述">
            <input className="settings-form-input" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
          </FormGroup>
          <FormGroup label="启动命令">
            <input className="settings-form-input" value={createForm.command} onChange={(e) => setCreateForm({ ...createForm, command: e.target.value })} placeholder="如：npx" />
          </FormGroup>
          <FormGroup label="启动参数（每行一个）">
            <textarea className="hook-script-editor" style={{ minHeight: 60 }} value={createForm.args} onChange={(e) => setCreateForm({ ...createForm, args: e.target.value })} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"} />
          </FormGroup>
          <FormGroup label="环境变量（JSON）">
            <textarea className="hook-script-editor" style={{ minHeight: 40 }} value={createForm.env} onChange={(e) => setCreateForm({ ...createForm, env: e.target.value })} placeholder='{}' />
          </FormGroup>
          <FormGroup label="启用">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={createForm.enabled} onChange={(e) => setCreateForm({ ...createForm, enabled: e.target.checked })} />
              <span className="settings-toggle-slider" />
            </label>
          </FormGroup>
          <FormGroup label="自动连接">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={createForm.autoConnect} onChange={(e) => setCreateForm({ ...createForm, autoConnect: e.target.checked })} />
              <span className="settings-toggle-slider" />
            </label>
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
            <button className="btn btn-primary" onClick={handleCreate}>创建</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── Plugin Config Panel ── */
function PluginConfigPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [editorData, setEditorData] = useState<{ name: string; description: string; version: string; type: string; entry: string; enabled: boolean; config: string }>({ name: '', description: '', version: '1.0.0', type: 'tool', entry: '', enabled: true, config: '{}' })
  const [originalData, setOriginalData] = useState<typeof editorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ id: '', name: '', description: '', version: '1.0.0', type: 'tool', entry: '', enabled: true, config: '{}' })

  const loadPlugins = useCallback(() => {
    api.agent.plugins()
      .then((res) => setPlugins(res.plugins))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  const selectPlugin = async (plugin: Plugin) => {
    setSelectedPlugin(plugin)
    try {
      const res = await api.agent.pluginRaw(plugin.id)
      const parsed = JSON.parse(res.content)
      const ed = {
        name: parsed.name || plugin.name,
        description: parsed.description || plugin.description || '',
        version: parsed.version || plugin.version || '1.0.0',
        type: parsed.type || plugin.type || 'tool',
        entry: parsed.entry || plugin.entry || '',
        enabled: parsed.enabled !== false,
        config: parsed.config ? JSON.stringify(parsed.config, null, 2) : '{}',
      }
      setEditorData(ed)
      setOriginalData({ ...ed })
    } catch {
      setEditorData({ name: plugin.name, description: plugin.description || '', version: plugin.version, type: plugin.type, entry: plugin.entry, enabled: plugin.enabled, config: JSON.stringify(plugin.config || {}, null, 2) })
      setOriginalData(null)
    }
  }

  const handleSave = async () => {
    if (!selectedPlugin) return
    setSaving(true)
    setSaved(false)
    try {
      let config = {}
      try { config = JSON.parse(editorData.config) } catch { /* keep empty */ }
      const data = {
        name: editorData.name,
        description: editorData.description,
        version: editorData.version,
        type: editorData.type as Plugin['type'],
        entry: editorData.entry,
        enabled: editorData.enabled,
        config,
      }
      await api.agent.savePlugin(selectedPlugin.id, data)
      setOriginalData({ ...editorData })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      loadPlugins()
    } catch (err) {
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!createForm.id || !createForm.name) {
      alert('请填写插件 ID 和名称')
      return
    }
    try {
      let config = {}
      try { config = JSON.parse(createForm.config) } catch { /* keep empty */ }
      const data = {
        id: createForm.id,
        name: createForm.name,
        description: createForm.description,
        version: createForm.version,
        type: createForm.type as Plugin['type'],
        entry: createForm.entry,
        enabled: createForm.enabled,
        config,
      }
      await api.agent.createPlugin(data)
      setShowCreate(false)
      setCreateForm({ id: '', name: '', description: '', version: '1.0.0', type: 'tool', entry: '', enabled: true, config: '{}' })
      loadPlugins()
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除插件 "${id}"？`)) return
    try {
      await api.agent.deletePlugin(id)
      if (selectedPlugin?.id === id) {
        setSelectedPlugin(null)
        setEditorData({ name: '', description: '', version: '1.0.0', type: 'tool', entry: '', enabled: true, config: '{}' })
        setOriginalData(null)
      }
      loadPlugins()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const isModified = originalData && (
    editorData.name !== originalData.name ||
    editorData.description !== originalData.description ||
    editorData.version !== originalData.version ||
    editorData.type !== originalData.type ||
    editorData.entry !== originalData.entry ||
    editorData.enabled !== originalData.enabled ||
    editorData.config !== originalData.config
  )

  const typeLabels: Record<string, string> = { tool: '工具', hook: 'Hook', route: '路由', middleware: '中间件' }

  if (loading) return <div className="settings-empty"><p>加载中...</p></div>

  return (
    <div className="skill-config">
      <div className="skill-sidebar">
        <div className="skill-sidebar-header">
          <span className="skill-sidebar-title">插件</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => setShowCreate(true)}>
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="skill-list">
          {plugins.map((p) => (
            <div
              key={p.id}
              className={`skill-list-item ${selectedPlugin?.id === p.id ? 'active' : ''}`}
              onClick={() => selectPlugin(p)}
            >
              <span className={`skill-list-icon ${p.enabled ? 'ai-purple' : 'ai-orange'}`}>
                <Puzzle size={11} strokeWidth={2.5} />
              </span>
              <div className="skill-list-body">
                <div className="skill-list-name">{p.name}</div>
                <div className="skill-list-id">
                  <span className="hook-event-badge">{typeLabels[p.type] || p.type}</span>
                  <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>v{p.version}</span>
                  {!p.enabled && <span className="hook-disabled-badge">已禁用</span>}
                </div>
              </div>
              <button className="icon-btn-sm danger" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {plugins.length === 0 && <div className="skill-list-empty">暂无插件，点击「新建」添加</div>}
        </div>
      </div>

      <div className="skill-editor">
        {selectedPlugin ? (
          <>
            <div className="skill-editor-header">
              <span className="skill-editor-title">
                <span className={`skill-list-icon ${editorData.enabled ? 'ai-purple' : 'ai-orange'}`}>
                  <Puzzle size={12} strokeWidth={2.5} />
                </span>
                {selectedPlugin.name}
                <span className="skill-editor-filename">{selectedPlugin.id}.json</span>
              </span>
              <div className="skill-editor-actions">
                {isModified && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>已修改</span>}
                {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                <button className="btn btn-primary" style={{ height: 28, fontSize: 11 }} onClick={handleSave} disabled={saving || !isModified}>
                  <Save size={12} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
            <div className="hook-editor-body">
              <FormGroup label="名称">
                <input className="settings-form-input" value={editorData.name} onChange={(e) => setEditorData({ ...editorData, name: e.target.value })} />
              </FormGroup>
              <FormGroup label="描述">
                <input className="settings-form-input" value={editorData.description} onChange={(e) => setEditorData({ ...editorData, description: e.target.value })} />
              </FormGroup>
              <FormGroup label="版本号">
                <input className="settings-form-input" value={editorData.version} onChange={(e) => setEditorData({ ...editorData, version: e.target.value })} />
              </FormGroup>
              <FormGroup label="类型">
                <select className="settings-form-input" value={editorData.type} onChange={(e) => setEditorData({ ...editorData, type: e.target.value })}>
                  <option value="tool">工具 — 注册自定义工具</option>
                  <option value="hook">Hook — 注册钩子函数</option>
                  <option value="route">路由 — 注册 HTTP 路由</option>
                  <option value="middleware">中间件 — 注册 Express 中间件</option>
                </select>
              </FormGroup>
              <FormGroup label="入口文件路径">
                <input className="settings-form-input" value={editorData.entry} onChange={(e) => setEditorData({ ...editorData, entry: e.target.value })} placeholder="./plugins/my-plugin/index.js" />
              </FormGroup>
              <FormGroup label="启用">
                <label className="settings-toggle-wrap">
                  <input type="checkbox" checked={editorData.enabled} onChange={(e) => setEditorData({ ...editorData, enabled: e.target.checked })} />
                  <span className="settings-toggle-slider" />
                  <span className="settings-toggle-label">启用后插件将在系统启动时加载</span>
                </label>
              </FormGroup>
              <FormGroup label="配置（JSON 格式）">
                <textarea
                  className="hook-script-editor"
                  style={{ minHeight: 80 }}
                  value={editorData.config}
                  onChange={(e) => setEditorData({ ...editorData, config: e.target.value })}
                  placeholder='{"key": "value"}'
                />
              </FormGroup>
            </div>
          </>
        ) : (
          <div className="settings-empty">
            <Puzzle size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p>选择左侧插件查看配置</p>
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="新建插件" onClose={() => setShowCreate(false)}>
          <FormGroup label="插件 ID（文件名）">
            <input className="settings-form-input" value={createForm.id} onChange={(e) => setCreateForm({ ...createForm, id: e.target.value })} placeholder="如：my-custom-tool" />
          </FormGroup>
          <FormGroup label="名称">
            <input className="settings-form-input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="如：自定义工具" />
          </FormGroup>
          <FormGroup label="描述">
            <input className="settings-form-input" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
          </FormGroup>
          <FormGroup label="版本号">
            <input className="settings-form-input" value={createForm.version} onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })} />
          </FormGroup>
          <FormGroup label="类型">
            <select className="settings-form-input" value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
              <option value="tool">工具</option>
              <option value="hook">Hook</option>
              <option value="route">路由</option>
              <option value="middleware">中间件</option>
            </select>
          </FormGroup>
          <FormGroup label="入口文件路径">
            <input className="settings-form-input" value={createForm.entry} onChange={(e) => setCreateForm({ ...createForm, entry: e.target.value })} />
          </FormGroup>
          <FormGroup label="启用">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={createForm.enabled} onChange={(e) => setCreateForm({ ...createForm, enabled: e.target.checked })} />
              <span className="settings-toggle-slider" />
            </label>
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
            <button className="btn btn-primary" onClick={handleCreate}>创建</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── Org Panel ── */
function OrgPanel() {
  const [orgs, setOrgs] = useState<any[]>([])
  const [tree, setTree] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['org_root']))
  const [parentForNew, setParentForNew] = useState('org_root')
  const [form, setForm] = useState({ name: '', parent_id: 'org_root' })

  const loadOrgs = () => {
    Promise.all([api.orgs.list(), api.orgs.tree()])
      .then(([flat, t]) => { setOrgs(flat); setTree(t) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadOrgs() }, [])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    if (!form.name) return
    try {
      if (editing) {
        await api.orgs.update(editing.id, { name: form.name })
      } else {
        await api.orgs.create({ name: form.name, parent_id: parentForNew })
      }
      setShowAdd(false)
      setEditing(null)
      setForm({ name: '', parent_id: 'org_root' })
      loadOrgs()
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该组织？')) return
    try { await api.orgs.delete(id); setSelected(null); loadOrgs() }
    catch (err) { alert('删除失败: ' + (err as Error).message) }
  }

  const startEdit = (org: any) => {
    setEditing(org)
    setForm({ name: org.name, parent_id: org.parentId || '' })
  }

  const renderTreeNodes = (nodes: any[], depth: number = 0) => {
    return nodes.map((node: any) => (
      <div key={node.id}>
        <div
          className={`org-tree-node ${selected?.id === node.id ? 'selected' : ''}`}
          style={{ paddingLeft: 12 + depth * 20 }}
          onClick={() => setSelected(node)}
        >
          <span className="org-tree-chevron" onClick={(e) => { e.stopPropagation(); toggleExpand(node.id) }}>
            {node.children?.length > 0 ? (expandedIds.has(node.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12, display: 'inline-block' }} />}
          </span>
          <Building2 size={13} style={{ opacity: 0.5, marginRight: 6 }} />
          <span className="org-tree-name">{node.name}</span>
          <span className="org-tree-badge">{node.children?.length || 0} 个子组织</span>
        </div>
        {node.children?.length > 0 && expandedIds.has(node.id) && renderTreeNodes(node.children, depth + 1)}
      </div>
    ))
  }

  if (loading) return <div className="settings-empty"><p>加载中...</p></div>

  return (
    <div className="org-layout">
      <div className="org-tree-panel">
        <div className="org-tree-header">
          <span className="org-tree-title">组织架构</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => { setShowAdd(true); setEditing(null); setForm({ name: '', parent_id: selected?.id || 'org_root' }); setParentForNew(selected?.id || 'org_root') }}>
            <Plus size={12} /> 添加组织
          </button>
        </div>
        <div className="org-tree">{renderTreeNodes(tree)}</div>
      </div>
      <div className="org-detail-panel">
        {selected ? (
          <>
            <div className="org-detail-header">
              <h3>{selected.name}</h3>
              <div className="org-detail-actions">
                <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => startEdit(selected)}><Edit3 size={11} /> 编辑</button>
                {selected.id !== 'org_root' && (
                  <button className="btn btn-ghost danger" style={{ height: 26, fontSize: 11 }} onClick={() => handleDelete(selected.id)}><Trash2 size={11} /> 删除</button>
                )}
              </div>
            </div>
            <div className="org-detail-info">
              <div className="detail-row"><span className="detail-label">组织ID</span><span>{selected.id}</span></div>
              <div className="detail-row"><span className="detail-label">上级组织</span><span>{selected.parentId || '无（根组织）'}</span></div>
              <div className="detail-row"><span className="detail-label">子组织数</span><span>{selected.children?.length || 0}</span></div>
              <div className="detail-row"><span className="detail-label">成员数</span><span>{orgs.find((o: any) => o.id === selected.id)?.user_count || 0}</span></div>
            </div>
          </>
        ) : (
          <div className="settings-empty"><Building2 size={32} style={{ opacity: 0.4, marginBottom: 12 }} /><p>选择左侧组织查看详情</p></div>
        )}
      </div>

      {(showAdd || editing) && (
        <Modal title={editing ? '编辑组织' : '添加组织'} onClose={() => { setShowAdd(false); setEditing(null) }}>
          <FormGroup label="组织名称">
            <input className="settings-form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：华北区" />
          </FormGroup>
          {!editing && (
            <FormGroup label="上级组织">
              <select className="settings-form-input" value={parentForNew} onChange={e => setParentForNew(e.target.value)}>
                {orgs.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </FormGroup>
          )}
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null) }}>取消</button>
            <button className="btn btn-primary" onClick={handleSave}>{editing ? '保存' : '添加'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── User Panel ── */
function UserPanel() {
  const [users, setUsers] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [orgs, setOrgs] = useState<any[]>([])
  const [allRoles, setAllRoles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterOrg, setFilterOrg] = useState('')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [form, setForm] = useState({ username: '', display_name: '', password: '', org_id: '', email: '', phone: '', enabled: true })
  const [roleModalUser, setRoleModalUser] = useState<any>(null)
  const [roleIds, setRoleIds] = useState<string[]>([])

  const pageSize = 10

  const loadUsers = () => {
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) }
    if (filterOrg) params.org_id = filterOrg
    if (search) params.search = search

    api.users.list(params).then(res => { setUsers(res.data); setTotal(res.total) }).catch(console.error).finally(() => setLoading(false))
  }

  const loadMeta = () => {
    api.orgs.list().then(setOrgs).catch(console.error)
    api.roles.list().then(setAllRoles).catch(console.error)
  }

  useEffect(() => { loadMeta() }, [])
  useEffect(() => { setPage(1) }, [filterOrg, search])
  useEffect(() => { loadUsers() }, [page, filterOrg, search])

  const handleSave = async () => {
    if (!form.username || !form.display_name) return
    try {
      if (editingUser) {
        const data: any = { ...form }
        if (!data.password) delete data.password
        await api.users.update(editingUser.id, data)
      } else {
        if (!form.password) { alert('请输入密码'); return }
        await api.users.create(form)
      }
      setShowForm(false); setEditingUser(null)
      setForm({ username: '', display_name: '', password: '', org_id: '', email: '', phone: '', enabled: true })
      loadUsers()
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该用户？')) return
    try { await api.users.delete(id); loadUsers() }
    catch (err) { alert('删除失败: ' + (err as Error).message) }
  }

  const openRoleModal = async (user: any) => {
    setRoleModalUser(user)
    try { const roles = await api.users.roles(user.id); setRoleIds(roles.map((r: any) => r.id)) }
    catch { setRoleIds([]) }
  }

  const saveRoles = async () => {
    if (!roleModalUser) return
    try { await api.users.setRoles(roleModalUser.id, roleIds); setRoleModalUser(null); loadUsers() }
    catch (err) { alert('保存失败: ' + (err as Error).message) }
  }

  const totalPages = Math.ceil(total / pageSize) || 1

  return (
    <div className="rbac-panel">
      <div className="rbac-toolbar">
        <input className="settings-form-input" style={{ width: 200 }} placeholder="搜索用户名/显示名..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="settings-form-input" style={{ width: 160 }} value={filterOrg} onChange={e => setFilterOrg(e.target.value)}>
          <option value="">全部组织</option>
          {orgs.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="btn btn-primary" style={{ height: 30, fontSize: 12 }} onClick={() => { setEditingUser(null); setForm({ username: '', display_name: '', password: '', org_id: filterOrg || '', email: '', phone: '', enabled: true }); setShowForm(true) }}>
          <Plus size={14} /> 添加用户
        </button>
      </div>

      {loading ? <div className="settings-empty"><p>加载中...</p></div> : (
        <>
          <table className="data-table rbac-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>显示名</th>
                <th>所属组织</th>
                <th>邮箱</th>
                <th>电话</th>
                <th>状态</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id}>
                  <td className="mono-cell">{u.username}</td>
                  <td>{u.display_name}</td>
                  <td>{u.org_name || '-'}</td>
                  <td>{u.email || '-'}</td>
                  <td>{u.phone || '-'}</td>
                  <td><span className={`status-tag ${u.enabled ? 'status-done' : 'status-overdue'}`}>{u.enabled ? '启用' : '禁用'}</span></td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }} onClick={() => { setEditingUser(u); setForm({ username: u.username, display_name: u.display_name, password: '', org_id: u.org_id || '', email: u.email || '', phone: u.phone || '', enabled: !!u.enabled }); setShowForm(true) }}><Edit3 size={11} /> 编辑</button>
                      <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }} onClick={() => openRoleModal(u)}><Shield size={11} /> 角色</button>
                      {u.id !== 'user_admin' && <button className="btn btn-ghost danger" style={{ height: 24, fontSize: 11 }} onClick={() => handleDelete(u.id)}><Trash2 size={11} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} className="table-empty">暂无用户</td></tr>}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="table-pagination">
              <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 7) { pageNum = i + 1 }
                else if (page <= 3) { pageNum = i + 1 }
                else if (page >= totalPages - 2) { pageNum = totalPages - 6 + i }
                else { pageNum = page - 3 + i }
                return <button key={pageNum} className={`page-btn ${pageNum === page ? 'current' : ''}`} onClick={() => setPage(pageNum)}>{pageNum}</button>
              })}
              <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
        </>
      )}

      {showForm && (
        <Modal title={editingUser ? '编辑用户' : '添加用户'} onClose={() => { setShowForm(false); setEditingUser(null) }}>
          <FormGroup label="用户名">
            <input className="settings-form-input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="登录用户名" />
          </FormGroup>
          <FormGroup label="显示名">
            <input className="settings-form-input" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="显示名称" />
          </FormGroup>
          <FormGroup label={editingUser ? '密码（留空不修改）' : '密码'}>
            <input className="settings-form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={editingUser ? '留空则不修改密码' : '登录密码'} />
          </FormGroup>
          <FormGroup label="所属组织">
            <select className="settings-form-input" value={form.org_id} onChange={e => setForm({ ...form, org_id: e.target.value })}>
              <option value="">无</option>
              {orgs.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FormGroup>
          <FormGroup label="邮箱">
            <input className="settings-form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
          </FormGroup>
          <FormGroup label="电话">
            <input className="settings-form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="手机号" />
          </FormGroup>
          <FormGroup label="启用">
            <label className="settings-toggle-wrap">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
              <span className="settings-toggle-slider" />
              <span className="settings-toggle-label">启用后用户才能登录</span>
            </label>
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingUser(null) }}>取消</button>
            <button className="btn btn-primary" onClick={handleSave}>{editingUser ? '保存' : '添加'}</button>
          </div>
        </Modal>
      )}

      {roleModalUser && (
        <Modal title={`分配角色 — ${roleModalUser.display_name}`} onClose={() => setRoleModalUser(null)}>
          <div className="role-checkbox-list">
            {allRoles.map((r: any) => (
              <label key={r.id} className="checkbox-row">
                <input type="checkbox" checked={roleIds.includes(r.id)} onChange={e => {
                  setRoleIds(e.target.checked ? [...roleIds, r.id] : roleIds.filter(id => id !== r.id))
                }} />
                <span>{r.name}</span>
                <span style={{ color: 'var(--color-muted)', fontSize: 11, marginLeft: 8 }}>{r.description}</span>
              </label>
            ))}
            {allRoles.length === 0 && <p style={{ color: 'var(--color-muted)', fontSize: 12 }}>暂无角色，请先创建角色</p>}
          </div>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setRoleModalUser(null)}>取消</button>
            <button className="btn btn-primary" onClick={saveRoles}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ── Role Panel ── */
function RolePanel() {
  const [roles, setRoles] = useState<any[]>([])
  const [selectedRole, setSelectedRole] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [permTab, setPermTab] = useState('menu')
  const [menus, setMenus] = useState<any[]>([])
  const [operations, setOperations] = useState<any[]>([])
  const [checkedMenus, setCheckedMenus] = useState<Set<string>>(new Set())
  const [checkedOps, setCheckedOps] = useState<Set<string>>(new Set())
  const [dataScopes, setDataScopes] = useState<Record<string, { rules: Array<{ field: string; op: string; value: string }>; logic: 'AND' | 'OR' }>>({})
  const [scopeFields, setScopeFields] = useState<Record<string, Array<{ field: string; label: string; type: string; options?: string[] }>>>({})
  const [savingPerm, setSavingPerm] = useState(false)

  // Skill permissions
  const [allSkills, setAllSkills] = useState<Skill[]>([])
  const [checkedSkills, setCheckedSkills] = useState<Set<string>>(new Set())
  const [savingSkillPerm, setSavingSkillPerm] = useState(false)

  // Role CRUD
  const [showForm, setShowForm] = useState(false)
  const [editingRole, setEditingRole] = useState<any>(null)
  const [form, setForm] = useState({ name: '', description: '' })

  const loadRoles = () => {
    api.roles.list().then(setRoles).catch(console.error).finally(() => setLoading(false))
  }
  const loadMeta = () => {
    api.menus.list().then(setMenus).catch(console.error)
    api.operations.list().then(setOperations).catch(console.error)
    api.scopeFields.list().then(setScopeFields).catch(console.error)
    api.agent.skills().then(res => setAllSkills(res.skills)).catch(console.error)
  }

  useEffect(() => { loadRoles(); loadMeta() }, [])

  useEffect(() => {
    if (!selectedRole) return
    api.roles.permissions(selectedRole.id).then(p => {
      setCheckedMenus(new Set(p.menus))
      setCheckedOps(new Set(p.operations))
      // Handle both old (raw SQL strings) and new (structured objects) formats
      const scopes: Record<string, any> = {}
      for (const key of ['orders', 'analysis_tasks', 'todos']) {
        const v = p.dataScopes?.[key]
        if (!v) {
          scopes[key] = { rules: [], logic: 'AND' as const }
        } else if (typeof v === 'object' && v.rules) {
          scopes[key] = v
        } else {
          // Legacy raw SQL — can't convert, start fresh
          scopes[key] = { rules: [], logic: 'AND' as const }
        }
      }
      setDataScopes(scopes)
    }).catch(console.error)
    // Load skill permissions for selected role
    api.roles.skillPermissions(selectedRole.id).then(sp => {
      setCheckedSkills(new Set(sp.skillIds))
    }).catch(console.error)
  }, [selectedRole])

  const handleSaveRole = async () => {
    if (!form.name) return
    try {
      if (editingRole) { await api.roles.update(editingRole.id, form) }
      else { await api.roles.create(form) }
      setShowForm(false); setEditingRole(null); setForm({ name: '', description: '' })
      loadRoles()
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
  }

  const handleDeleteRole = async (id: string) => {
    if (!confirm('确定要删除该角色？')) return
    try { await api.roles.delete(id); if (selectedRole?.id === id) setSelectedRole(null); loadRoles() }
    catch (err) { alert('删除失败: ' + (err as Error).message) }
  }

  const savePermissions = async () => {
    if (!selectedRole) return
    setSavingPerm(true)
    try {
      // Only include scopes that have at least one rule
      const cleanScopes: Record<string, any> = {}
      for (const [key, scope] of Object.entries(dataScopes)) {
        if (scope.rules && scope.rules.length > 0) {
          cleanScopes[key] = { rules: scope.rules, logic: scope.logic }
        }
      }
      await api.roles.setPermissions(selectedRole.id, {
        menus: Array.from(checkedMenus),
        operations: Array.from(checkedOps),
        dataScopes: cleanScopes,
      })
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
    finally { setSavingPerm(false) }
  }

  const saveSkillPermissions = async () => {
    if (!selectedRole) return
    setSavingSkillPerm(true)
    try {
      await api.roles.setSkillPermissions(selectedRole.id, Array.from(checkedSkills))
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
    finally { setSavingSkillPerm(false) }
  }

  const toggleMenu = (id: string, children: any[]) => {
    setCheckedMenus(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        children.forEach((c: any) => { next.delete(c.id); if (c.children) removeChildren(next, c.children) })
      } else {
        next.add(id)
        children.forEach((c: any) => { next.add(c.id); if (c.children) addChildren(next, c.children) })
      }
      return next
    })
  }

  const toggleMenuSingle = (id: string) => {
    setCheckedMenus(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const renderMenuTree = (nodes: any[], depth: number = 0): JSX.Element[] => {
    return nodes.flatMap((node: any) => [
      <div key={node.id} className="checkbox-tree-row" style={{ paddingLeft: 12 + depth * 20 }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={checkedMenus.has(node.id)} onChange={() => toggleMenu(node.id, node.children || [])} />
          <span>{node.label}</span>
          {node.path && <span className="menu-path-hint">{node.path}</span>}
        </label>
      </div>,
      ...(node.children?.length > 0 ? renderMenuTree(node.children, depth + 1) : []),
    ])
  }

  // Load permission tab content
  const renderPermTab = () => {
    switch (permTab) {
      case 'menu':
        return (
          <div className="permission-tab-content">
            <div className="permission-tab-header">
              <span>菜单权限 — 控制用户可见的菜单项</span>
              <button className="btn btn-primary" style={{ height: 26, fontSize: 11 }} onClick={savePermissions} disabled={savingPerm}><Save size={11} /> 保存</button>
            </div>
            <div className="checkbox-tree">{renderMenuTree(menus)}</div>
          </div>
        )
      case 'operation':
        return (
          <div className="permission-tab-content">
            <div className="permission-tab-header">
              <span>操作权限 — 控制用户可以执行的操作</span>
              <button className="btn btn-primary" style={{ height: 26, fontSize: 11 }} onClick={savePermissions} disabled={savingPerm}><Save size={11} /> 保存</button>
            </div>
            <div className="operations-list">
              {operations.map((group: any) => (
                <div key={group.group} className="ops-group">
                  <div className="ops-group-header">{group.group}</div>
                  {group.items.map((op: any) => (
                    <label key={op.code} className="checkbox-row ops-item">
                      <input type="checkbox" checked={checkedOps.has(op.code)} onChange={() => {
                        setCheckedOps(prev => { const next = new Set(prev); next.has(op.code) ? next.delete(op.code) : next.add(op.code); return next })
                      }} />
                      <span>{op.name}</span>
                      <span className="ops-code">{op.code}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )
      case 'data':
        return (
          <div className="permission-tab-content">
            <div className="permission-tab-header">
              <span>数据权限 — 通过可视化规则限制数据可见范围</span>
              <button className="btn btn-primary" style={{ height: 26, fontSize: 11 }} onClick={savePermissions} disabled={savingPerm}><Save size={11} /> 保存</button>
            </div>
            <div className="data-scope-list">
              <ScopeBuilder
                resourceKey="orders"
                label="订单数据"
                scope={dataScopes.orders || { rules: [], logic: 'AND' }}
                fields={scopeFields.orders || []}
                onChange={(s) => setDataScopes(prev => ({ ...prev, orders: s }))}
              />
              <ScopeBuilder
                resourceKey="analysis_tasks"
                label="分析任务数据"
                scope={dataScopes.analysis_tasks || { rules: [], logic: 'AND' }}
                fields={scopeFields.analysis_tasks || []}
                onChange={(s) => setDataScopes(prev => ({ ...prev, analysis_tasks: s }))}
              />
              <ScopeBuilder
                resourceKey="todos"
                label="执行任务数据"
                scope={dataScopes.todos || { rules: [], logic: 'AND' }}
                fields={scopeFields.todos || []}
                onChange={(s) => setDataScopes(prev => ({ ...prev, todos: s }))}
              />
              <div className="data-scope-note">
                提示: 未配置规则表示不限制数据访问。多条规则之间可配置为「且」或「或」关系。
              </div>
            </div>
          </div>
        )
      case 'skill':
        return (
          <div className="permission-tab-content">
            <div className="permission-tab-header">
              <span>Skill 权限 — 控制角色可以使用的智能体</span>
              <button className="btn btn-primary" style={{ height: 26, fontSize: 11 }} onClick={saveSkillPermissions} disabled={savingSkillPerm}><Save size={11} /> 保存</button>
            </div>
            <div className="skill-perm-list">
              {allSkills.length === 0 ? (
                <div className="settings-empty"><p>暂无可用 Skill</p></div>
              ) : (
                allSkills.map(skill => {
                  const Icon = getSkillIcon(skill.icon)
                  return (
                    <label key={skill.id} className="checkbox-row skill-perm-item">
                      <input
                        type="checkbox"
                        checked={checkedSkills.has(skill.id)}
                        onChange={() => {
                          setCheckedSkills(prev => {
                            const next = new Set(prev)
                            next.has(skill.id) ? next.delete(skill.id) : next.add(skill.id)
                            return next
                          })
                        }}
                      />
                      <Icon size={16} className={`skill-icon-color-${skill.color || 'ai-purple'}`} />
                      <div className="skill-perm-body">
                        <span className="skill-perm-name">{skill.name}</span>
                        <span className="skill-perm-id">{skill.id}</span>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  if (loading) return <div className="settings-empty"><p>加载中...</p></div>

  return (
    <div className="role-layout">
      <div className="role-sidebar">
        <div className="role-sidebar-header">
          <span className="role-sidebar-title">角色列表</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => { setEditingRole(null); setForm({ name: '', description: '' }); setShowForm(true) }}>
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="role-list">
          {roles.map((r: any) => (
            <div key={r.id} className={`role-list-item ${selectedRole?.id === r.id ? 'active' : ''}`} onClick={() => setSelectedRole(r)}>
              <Shield size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              <div className="role-list-body">
                <div className="role-list-name">{r.name}</div>
                <div className="role-list-desc">{r.description || '无描述'}</div>
              </div>
              <span className="role-user-count">{r.user_count || 0} 人</span>
              <div className="role-list-actions" onClick={e => e.stopPropagation()}>
                <button className="icon-btn-sm" title="编辑" onClick={() => { setEditingRole(r); setForm({ name: r.name, description: r.description || '' }); setShowForm(true) }}><Edit3 size={12} /></button>
                {r.id !== 'role_admin' && <button className="icon-btn-sm danger" title="删除" onClick={() => handleDeleteRole(r.id)}><Trash2 size={12} /></button>}
              </div>
            </div>
          ))}
          {roles.length === 0 && <div className="role-list-empty">暂无角色</div>}
        </div>
      </div>

      <div className="role-permission-panel">
        {selectedRole ? (
          <>
            <div className="permission-tabs">
              <button className={`permission-tab ${permTab === 'menu' ? 'active' : ''}`} onClick={() => setPermTab('menu')}>菜单权限</button>
              <button className={`permission-tab ${permTab === 'operation' ? 'active' : ''}`} onClick={() => setPermTab('operation')}>操作权限</button>
              <button className={`permission-tab ${permTab === 'data' ? 'active' : ''}`} onClick={() => setPermTab('data')}>数据权限</button>
              <button className={`permission-tab ${permTab === 'skill' ? 'active' : ''}`} onClick={() => setPermTab('skill')}>Skill 权限</button>
            </div>
            {renderPermTab()}
          </>
        ) : (
          <div className="settings-empty">
            <Shield size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p>选择左侧角色配置权限</p>
          </div>
        )}
      </div>

      {showForm && (
        <Modal title={editingRole ? '编辑角色' : '新建角色'} onClose={() => { setShowForm(false); setEditingRole(null) }}>
          <FormGroup label="角色名称">
            <input className="settings-form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：区域经理" />
          </FormGroup>
          <FormGroup label="描述">
            <input className="settings-form-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="简要描述该角色的职责" />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingRole(null) }}>取消</button>
            <button className="btn btn-primary" onClick={handleSaveRole}>{editingRole ? '保存' : '创建'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function removeChildren(set: Set<string>, children: any[]) {
  children.forEach((c: any) => { set.delete(c.id); if (c.children) removeChildren(set, c.children) })
}
function addChildren(set: Set<string>, children: any[]) {
  children.forEach((c: any) => { set.add(c.id); if (c.children) addChildren(set, c.children) })
}

/* ── Data Scope Visual Rule Builder ── */

const OPERATORS_BY_TYPE: Record<string, Array<{ value: string; label: string }>> = {
  string: [
    { value: '=', label: '等于' },
    { value: '!=', label: '不等于' },
    { value: 'IN', label: '包含于' },
    { value: 'NOT IN', label: '不包含于' },
    { value: 'LIKE', label: '模糊匹配' },
  ],
  number: [
    { value: '=', label: '等于' },
    { value: '!=', label: '不等于' },
    { value: '>', label: '大于' },
    { value: '<', label: '小于' },
    { value: '>=', label: '大于等于' },
    { value: '<=', label: '小于等于' },
  ],
  date: [
    { value: '=', label: '等于' },
    { value: '!=', label: '不等于' },
    { value: '>', label: '晚于' },
    { value: '<', label: '早于' },
    { value: '>=', label: '不早于' },
    { value: '<=', label: '不晚于' },
  ],
}

interface ScopeRule {
  field: string
  op: string
  value: string
}

interface StructuredScope {
  rules: ScopeRule[]
  logic: 'AND' | 'OR'
}

function ScopeBuilder({ resourceKey, label, scope, fields, onChange }: {
  resourceKey: string
  label: string
  scope: StructuredScope
  fields: Array<{ field: string; label: string; type: string; options?: string[] }>
  onChange: (s: StructuredScope) => void
}) {
  const rules = scope.rules || []
  const logic = scope.logic || 'AND'

  const addRule = () => {
    const firstField = fields[0]
    const firstOp = firstField ? OPERATORS_BY_TYPE[firstField.type]?.[0]?.value || '=' : '='
    onChange({
      ...scope,
      rules: [...rules, { field: firstField?.field || '', op: firstOp, value: '' }],
      logic,
    })
  }

  const removeRule = (idx: number) => {
    onChange({ ...scope, rules: rules.filter((_, i) => i !== idx), logic })
  }

  const updateRule = (idx: number, part: Partial<ScopeRule>) => {
    const updated = rules.map((r, i) => i === idx ? { ...r, ...part } : r)
    // Reset op when field type changes
    if (part.field) {
      const fieldMeta = fields.find(f => f.field === part.field)
      if (fieldMeta) {
        const ops = OPERATORS_BY_TYPE[fieldMeta.type]
        if (ops && !ops.find(o => o.value === updated[idx].op)) {
          updated[idx].op = ops[0].value
        }
      }
    }
    onChange({ ...scope, rules: updated, logic })
  }

  const getFieldType = (field: string): string => fields.find(f => f.field === field)?.type || 'string'
  const getFieldOptions = (field: string): string[] | undefined => fields.find(f => f.field === field)?.options

  return (
    <div className="scope-builder">
      <div className="scope-builder-header">
        <span className="scope-builder-label">{label}</span>
        {rules.length === 0 && <span className="scope-builder-hint">未限制</span>}
      </div>

      {rules.map((rule, idx) => (
        <div key={idx} className="scope-rule-row">
          <select
            className="scope-rule-field"
            value={rule.field}
            onChange={e => updateRule(idx, { field: e.target.value })}
          >
            {fields.map(f => (
              <option key={f.field} value={f.field}>{f.label}</option>
            ))}
          </select>

          <select
            className="scope-rule-op"
            value={rule.op}
            onChange={e => updateRule(idx, { op: e.target.value })}
          >
            {(OPERATORS_BY_TYPE[getFieldType(rule.field)] || OPERATORS_BY_TYPE.string).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {(() => {
            const fieldType = getFieldType(rule.field)
            const options = getFieldOptions(rule.field)
            if (options && (rule.op === '=' || rule.op === '!=' || rule.op === 'IN' || rule.op === 'NOT IN')) {
              return (
                <select
                  className="scope-rule-value"
                  value={rule.value}
                  onChange={e => updateRule(idx, { value: e.target.value })}
                >
                  <option value="">选择...</option>
                  {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              )
            }
            if (rule.op === 'IN' || rule.op === 'NOT IN') {
              return (
                <input
                  className="scope-rule-value"
                  value={rule.value}
                  onChange={e => updateRule(idx, { value: e.target.value })}
                  placeholder="值1, 值2, 值3..."
                />
              )
            }
            return (
              <input
                className="scope-rule-value"
                value={rule.value}
                onChange={e => updateRule(idx, { value: e.target.value })}
                placeholder={fieldType === 'date' ? '2026-01-01' : fieldType === 'number' ? '100' : '输入值...'}
              />
            )
          })()}

          {getFieldType(rule.field) === 'string' && (rule.op === '=' || rule.op === '!=' || rule.op === 'LIKE') && (
            <label className="scope-rule-current-user" title="使用当前登录用户">
              <input
                type="checkbox"
                checked={rule.value === ':currentUser'}
                onChange={e => updateRule(idx, { value: e.target.checked ? ':currentUser' : '' })}
              />
              <span>当前用户</span>
            </label>
          )}

          <button className="scope-rule-remove" onClick={() => removeRule(idx)} title="删除规则">
            <X size={12} />
          </button>
        </div>
      ))}

      <div className="scope-builder-footer">
        <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }} onClick={addRule}>
          <Plus size={11} /> 添加规则
        </button>
        {rules.length > 1 && (
          <div className="scope-logic-toggle">
            <span className="scope-logic-label">规则关系:</span>
            <button
              className={`scope-logic-btn ${logic === 'AND' ? 'active' : ''}`}
              onClick={() => onChange({ ...scope, rules, logic: 'AND' })}
            >
              且 (AND)
            </button>
            <button
              className={`scope-logic-btn ${logic === 'OR' ? 'active' : ''}`}
              onClick={() => onChange({ ...scope, rules, logic: 'OR' })}
            >
              或 (OR)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Reusable Components ── */

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}

/* ── Cron Task Panel ── */
function CronTaskPanel() {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [runOutput, setRunOutput] = useState<string | null>(null)

  // Form state for selected/editing task
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formSchedule, setFormSchedule] = useState('* * * * *')
  const [formScript, setFormScript] = useState('')
  const [formScriptType, setFormScriptType] = useState<'bash' | 'python' | 'js'>('bash')
  const [formCallAgent, setFormCallAgent] = useState(false)
  const [formAgentSkillId, setFormAgentSkillId] = useState('')
  const [formAgentPrompt, setFormAgentPrompt] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)
  const [formModified, setFormModified] = useState(false)

  // Create form
  const [createId, setCreateId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')

  // Skills list for agent skill dropdown
  const [skills, setSkills] = useState<Skill[]>([])

  const loadTaskList = useCallback(() => {
    api.agent.cronTasks()
      .then((res) => setTasks(res.tasks))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadTaskList()
    api.agent.skills().then((res) => setSkills(res.skills)).catch(() => {})
  }, [loadTaskList])

  const selectTask = async (id: string) => {
    setSelectedTaskId(id)
    try {
      const res = await api.agent.cronTask(id)
      const t = res.task
      setFormName(t.name)
      setFormDesc(t.description)
      setFormSchedule(t.schedule)
      setFormScript(t.script)
      setFormScriptType(t.scriptType)
      setFormCallAgent(t.callAgent)
      setFormAgentSkillId(t.agentSkillId || '')
      setFormAgentPrompt(t.agentPrompt || '')
      setFormEnabled(t.enabled)
      setFormModified(false)
    } catch {
      setSelectedTaskId(null)
    }
  }

  const handleSave = async () => {
    if (!selectedTaskId) return
    setSaving(true)
    setSaved(false)
    try {
      await api.agent.updateCronTask(selectedTaskId, {
        name: formName,
        description: formDesc,
        schedule: formSchedule,
        script: formScript,
        scriptType: formScriptType,
        callAgent: formCallAgent,
        agentSkillId: formAgentSkillId || undefined,
        agentPrompt: formAgentPrompt || undefined,
        enabled: formEnabled,
      })
      setFormModified(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      loadTaskList()
    } catch (err) {
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!createId || !createName) return
    try {
      await api.agent.createCronTask({
        id: createId,
        name: createName,
        description: createDesc,
        schedule: '0 8 * * *',
        scriptType: 'bash',
      })
      setShowCreate(false)
      setCreateId('')
      setCreateName('')
      setCreateDesc('')
      loadTaskList()
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除定时任务 "${id}"？`)) return
    try {
      await api.agent.deleteCronTask(id)
      if (selectedTaskId === id) {
        setSelectedTaskId(null)
      }
      loadTaskList()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  const handleRun = async (id: string) => {
    setRunningTaskId(id)
    setRunOutput(null)
    try {
      const res = await api.agent.runCronTask(id)
      setRunOutput(res.output || res.error || '执行完成')
    } catch (err) {
      setRunOutput('执行失败: ' + (err as Error).message)
    } finally {
      setRunningTaskId(null)
    }
  }

  const handleFormChange = (setter: (v: any) => void, value: any) => {
    setter(value)
    setFormModified(true)
  }

  const toggleEnabled = async (task: CronTask) => {
    try {
      await api.agent.updateCronTask(task.id, { enabled: !task.enabled })
      loadTaskList()
    } catch (err) {
      alert('切换失败: ' + (err as Error).message)
    }
  }

  const cronPresets = [
    { label: '每分钟', value: '* * * * *' },
    { label: '每5分钟', value: '*/5 * * * *' },
    { label: '每小时', value: '0 * * * *' },
    { label: '每天8点', value: '0 8 * * *' },
    { label: '每天18点', value: '0 18 * * *' },
    { label: '每周一9点', value: '0 9 * * 1' },
    { label: '每月1号10点', value: '0 10 1 * *' },
  ]

  if (loading) {
    return <div className="settings-empty"><p>加载中...</p></div>
  }

  return (
    <div className="skill-config">
      {/* Left: Task list */}
      <div className="skill-sidebar">
        <div className="skill-sidebar-header">
          <span className="skill-sidebar-title">定时任务</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={() => setShowCreate(true)}>
            <Plus size={12} /> 新建
          </button>
        </div>
        <div className="skill-list">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`skill-list-item ${selectedTaskId === t.id ? 'active' : ''}`}
              onClick={() => selectTask(t.id)}
            >
              <span className={`skill-list-icon ${t.enabled ? 'ai-blue' : ''}`} style={{ opacity: t.enabled ? 1 : 0.4 }}>
                <Clock size={11} />
              </span>
              <div className="skill-list-body">
                <div className="skill-list-name">{t.name}</div>
                <div className="skill-list-id" style={{ fontSize: 10 }}>{t.schedule}</div>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {t.enabled && <div className="cron-status-dot" title="已启用" />}
                <button
                  className="icon-btn-sm"
                  title="手动执行"
                  onClick={(e) => { e.stopPropagation(); handleRun(t.id) }}
                  disabled={runningTaskId === t.id}
                >
                  <Play size={11} />
                </button>
                <button
                  className="icon-btn-sm danger"
                  title="删除"
                  onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="skill-list-empty">暂无定时任务，点击「新建」创建</div>
          )}
        </div>
      </div>

      {/* Center: Editor */}
      <div className="skill-editor">
        {selectedTaskId ? (
          <>
            <div className="skill-editor-header">
              <span className="skill-editor-title">
                <Clock size={12} />
                <span style={{ marginLeft: 6 }}>{formName}</span>
              </span>
              <div className="skill-editor-actions">
                {formModified && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>已修改</span>}
                {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                <button className="btn btn-ghost" style={{ height: 28, fontSize: 11 }} onClick={() => toggleEnabled(tasks.find(t => t.id === selectedTaskId)!)}>
                  {formEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  {formEnabled ? '已启用' : '已禁用'}
                </button>
                <button className="btn btn-primary" style={{ height: 28, fontSize: 11 }} onClick={handleSave} disabled={saving || !formModified}>
                  <Save size={12} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
            <div className="skill-editor-body" style={{ flexDirection: 'column', padding: 16, overflow: 'auto' }}>
              {/* Name & Description */}
              <div className="cron-form-row">
                <div className="settings-form-group" style={{ flex: 1 }}>
                  <label className="settings-form-label">任务名称</label>
                  <input className="settings-form-input" value={formName} onChange={(e) => handleFormChange(setFormName, e.target.value)} />
                </div>
              </div>
              <div className="cron-form-row">
                <div className="settings-form-group" style={{ flex: 1 }}>
                  <label className="settings-form-label">描述</label>
                  <input className="settings-form-input" value={formDesc} onChange={(e) => handleFormChange(setFormDesc, e.target.value)} />
                </div>
              </div>

              {/* Cron schedule */}
              <div className="settings-form-group">
                <label className="settings-form-label">Cron 表达式</label>
                <input
                  className="settings-form-input"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                  value={formSchedule}
                  onChange={(e) => handleFormChange(setFormSchedule, e.target.value)}
                />
                <div className="cron-presets">
                  {cronPresets.map((p) => (
                    <button
                      key={p.value}
                      className={`cron-preset-btn ${formSchedule === p.value ? 'active' : ''}`}
                      onClick={() => handleFormChange(setFormSchedule, p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Script type */}
              <div className="cron-form-row">
                <div className="settings-form-group" style={{ flex: 1 }}>
                  <label className="settings-form-label">脚本类型</label>
                  <select className="settings-form-input" value={formScriptType} onChange={(e) => handleFormChange(setFormScriptType, e.target.value as any)}>
                    <option value="bash">Bash / Shell</option>
                    <option value="python">Python</option>
                    <option value="js">JavaScript (Node)</option>
                  </select>
                </div>
              </div>

              {/* Agent call settings */}
              <div className="cron-form-row">
                <div className="settings-form-group" style={{ flex: 1 }}>
                  <label className="settings-form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={formCallAgent}
                      onChange={(e) => handleFormChange(setFormCallAgent, e.target.checked)}
                    />
                    定时触发时调用 AI Agent
                  </label>
                </div>
              </div>
              {formCallAgent && (
                <>
                  <div className="cron-form-row">
                    <div className="settings-form-group" style={{ flex: 1 }}>
                      <label className="settings-form-label">选择 Agent Skill</label>
                      <select className="settings-form-input" value={formAgentSkillId} onChange={(e) => handleFormChange(setFormAgentSkillId, e.target.value)}>
                        <option value="">-- 选择 Skill --</option>
                        {skills.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="cron-form-row">
                    <div className="settings-form-group" style={{ flex: 1 }}>
                      <label className="settings-form-label">发给 Agent 的提示词</label>
                      <textarea
                        className="settings-form-input"
                        rows={3}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                        value={formAgentPrompt}
                        onChange={(e) => handleFormChange(setFormAgentPrompt, e.target.value)}
                        placeholder="如：生成今日订单履约日报..."
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Run output */}
              {runOutput && (
                <div className="settings-form-group">
                  <label className="settings-form-label">手动执行输出</label>
                  <pre className="cron-run-output">{runOutput}</pre>
                </div>
              )}

              {/* Script editor */}
              <div className="settings-form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <label className="settings-form-label">脚本内容</label>
                <ScriptEditor
                  value={formScript}
                  onChange={(v) => handleFormChange(setFormScript, v)}
                  language={formScriptType}
                  minHeight="400px"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="settings-empty">
            <Clock size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p>选择左侧定时任务，或点击「新建」创建</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal title="新建定时任务" onClose={() => setShowCreate(false)}>
          <FormGroup label="任务 ID（目录名）">
            <input className="settings-form-input" value={createId} onChange={(e) => setCreateId(e.target.value)} placeholder="如：daily-report" />
          </FormGroup>
          <FormGroup label="任务名称">
            <input className="settings-form-input" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="如：日报生成" />
          </FormGroup>
          <FormGroup label="描述">
            <input className="settings-form-input" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="简要描述该定时任务" />
          </FormGroup>
          <div className="settings-form-actions">
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
            <button className="btn btn-primary" onClick={handleCreate}>创建</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

const CHANNEL_TYPES: Record<string, { label: string; desc: string }> = {
  email: { label: '邮件', desc: '通过 SMTP 发送邮件通知' },
  feishu_webhook: { label: '飞书 Webhook', desc: '通过飞书机器人 Webhook 发送消息' },
  feishu_app: { label: '飞书应用', desc: '通过飞书自建应用发送消息' },
  wecom: { label: '企业微信', desc: '通过企业微信机器人 Webhook 发送消息' },
}

function NotificationPanel() {
  // ── Channel state ──
  const [channels, setChannels] = useState<any[]>([])
  const [selectedChannel, setSelectedChannel] = useState<any>(null)
  const [channelHealth, setChannelHealth] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // ── Editor tabs ──
  const [activeTab, setActiveTab] = useState('config')

  // ── Form state ──
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('email')
  const [formEnabled, setFormEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Email config
  const [emailHost, setEmailHost] = useState(''); const [emailPort, setEmailPort] = useState(587)
  const [emailUser, setEmailUser] = useState(''); const [emailPassword, setEmailPassword] = useState('')
  const [emailFrom, setEmailFrom] = useState(''); const [emailSecure, setEmailSecure] = useState(false)
  // Bot config
  const [webhookUrl, setWebhookUrl] = useState('')
  // Feishu App config
  const [feishuAppId, setFeishuAppId] = useState(''); const [feishuAppSecret, setFeishuAppSecret] = useState('')
  const [feishuReceiveIdType, setFeishuReceiveIdType] = useState('open_id'); const [feishuReceiveId, setFeishuReceiveId] = useState('')

  // Test/send state
  const [testing, setTesting] = useState(false); const [testResult, setTestResult] = useState<string | null>(null)
  const [sendTo, setSendTo] = useState(''); const [sendSubject, setSendSubject] = useState('')
  const [sendBody, setSendBody] = useState(''); const [sendTemplateId, setSendTemplateId] = useState('')
  const [sending, setSendingInner] = useState(false); const [sendResult, setSendResult] = useState<string | null>(null)

  // Template state
  const [templates, setTemplates] = useState<any[]>([])
  const [tplEditing, setTplEditing] = useState<any>(null)
  const [showTplCreate, setShowTplCreate] = useState(false)
  const [tplForm, setTplForm] = useState({ id: '', name: '', subject: '', body: '', variables: [] as any[] })

  // Log state
  const [logs, setLogs] = useState<any[]>([]); const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(1); const [logsFilterSuccess, setLogsFilterSuccess] = useState<number | undefined>()
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null)

  // Wizard
  const [showWizard, setShowWizard] = useState(false); const [wizardStep, setWizardStep] = useState(1)
  const [wizardType, setWizardType] = useState('email')
  const [wizardId, setWizardId] = useState(''); const [wizardName, setWizardName] = useState('')
  const [wizardConfig, setWizardConfig] = useState<Record<string, any>>({})
  const [wizardTesting, setWizardTesting] = useState(false); const [wizardTestResult, setWizardTestResult] = useState<string | null>(null)

  // ── Data loading ──
  const loadChannels = useCallback(() => {
    api.notifications.channels.list()
      .then((res) => setChannels(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const loadTemplates = useCallback(() => {
    api.notifications.templates.list()
      .then((res) => setTemplates(res.data))
      .catch(console.error)
  }, [])

  const loadLogs = useCallback(() => {
    api.notifications.logs.list({ channelId: selectedChannel?.id, success: logsFilterSuccess, page: logsPage, pageSize: 20 })
      .then((res) => { setLogs(res.data); setLogsTotal(res.total) })
      .catch(console.error)
  }, [selectedChannel, logsFilterSuccess, logsPage])

  const loadHealth = useCallback(async () => {
    const h: Record<string, string> = {}
    for (const ch of channels) {
      try {
        const res = await api.notifications.health(ch.id)
        h[ch.id] = res.status
      } catch { h[ch.id] = 'unknown' }
    }
    setChannelHealth(h)
  }, [channels])

  useEffect(() => { loadChannels() }, [loadChannels])
  useEffect(() => { loadTemplates() }, [])
  useEffect(() => { if (channels.length > 0) loadHealth() }, [channels.length, loadHealth])
  useEffect(() => { if (selectedChannel) { loadLogs(); setSendTo(''); setSendSubject(''); setSendBody(''); setSendTemplateId(''); setSendResult(null) } }, [activeTab, loadLogs, selectedChannel])

  useEffect(() => {
    const handler = () => { loadChannels(); loadTemplates() }
    window.addEventListener('settings:refresh', handler)
    return () => window.removeEventListener('settings:refresh', handler)
  }, [loadChannels, loadTemplates])

  // ── Channel selection ──
  const selectChannel = (ch: any) => {
    setSelectedChannel(ch)
    setActiveTab('config')
    setTestResult(null)
    setFormName(ch.name); setFormType(ch.type); setFormEnabled(!!ch.enabled)
    const cfg = JSON.parse(ch.config_json || '{}')
    if (ch.type === 'email') {
      setEmailHost(cfg.host || ''); setEmailPort(cfg.port || 587); setEmailUser(cfg.user || '')
      setEmailPassword(cfg.password || ''); setEmailFrom(cfg.from || ''); setEmailSecure(cfg.secure || false)
      setWebhookUrl(''); setFeishuAppId(''); setFeishuAppSecret(''); setFeishuReceiveIdType('open_id'); setFeishuReceiveId('')
      setSendTo(cfg.user || cfg.from || '')
    } else if (ch.type === 'feishu_app') {
      setFeishuAppId(cfg.app_id || ''); setFeishuAppSecret(cfg.app_secret || '')
      setFeishuReceiveIdType(cfg.receive_id_type || 'open_id'); setFeishuReceiveId(cfg.receive_id || '')
      setWebhookUrl(''); setEmailHost(''); setEmailPort(587); setEmailUser(''); setEmailPassword(''); setEmailFrom(''); setEmailSecure(false)
      setSendTo(cfg.receive_id || '')
    } else {
      setWebhookUrl(cfg.webhook_url || '')
      setEmailHost(''); setEmailPort(587); setEmailUser(''); setEmailPassword(''); setEmailFrom(''); setEmailSecure(false)
      setFeishuAppId(''); setFeishuAppSecret(''); setFeishuReceiveIdType('open_id'); setFeishuReceiveId('')
      setSendTo('')
    }
  }

  // ── Save config ──
  const handleSave = async () => {
    if (!selectedChannel) return
    setSaving(true); setSaved(false)
    try {
      const config = formType === 'email'
        ? { host: emailHost, port: emailPort, user: emailUser, password: emailPassword, from: emailFrom, secure: emailSecure }
        : formType === 'feishu_app'
        ? { app_id: feishuAppId, app_secret: feishuAppSecret, receive_id_type: feishuReceiveIdType, receive_id: feishuReceiveId }
        : { webhook_url: webhookUrl }
      await api.notifications.channels.update(selectedChannel.id, { name: formName, config, enabled: formEnabled })
      setSaved(true); setTimeout(() => setSaved(false), 2000); loadChannels()
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`确定要删除通知渠道 "${id}"？`)) return
    try {
      await api.notifications.channels.delete(id)
      if (selectedChannel?.id === id) { setSelectedChannel(null) }
      loadChannels()
    } catch (err) { alert('删除失败: ' + (err as Error).message) }
  }

  const handleTest = async () => {
    if (!selectedChannel) return
    setTesting(true); setTestResult(null)
    try {
      const res = await api.notifications.test(selectedChannel.id)
      setTestResult(res.success ? '✅ ' + (res.detail || '发送成功') : '❌ ' + (res.error || '未知错误'))
      loadHealth(); loadLogs()
    } catch (err) { setTestResult('❌ ' + (err as Error).message) }
    finally { setTesting(false) }
  }

  // ── Quick send ──
  const handleSend = async () => {
    if (!selectedChannel || !sendBody) return
    setSendingInner(true); setSendResult(null)
    try {
      const res = await api.notifications.send({
        channelId: selectedChannel.id, to: sendTo, subject: sendSubject,
        message: sendBody, templateId: sendTemplateId || undefined,
      })
      setSendResult(res.success ? '✅ ' + (res.detail || '发送成功') : '❌ ' + (res.error || '未知错误'))
      loadHealth(); loadLogs()
    } catch (err) { setSendResult('❌ ' + (err as Error).message) }
    finally { setSendingInner(false) }
  }

  // ── Template pick ──
  const pickTemplate = (tpl: any) => {
    setSendTemplateId(tpl.id)
    setSendSubject(tpl.subject || '')
    setSendBody(tpl.body || '')
  }

  // ── Template CRUD ──
  const handleTplSave = async () => {
    if (!tplForm.name) return
    try {
      if (tplEditing === 'new') {
        await api.notifications.templates.create({ id: tplForm.id, name: tplForm.name, subject: tplForm.subject, body: tplForm.body, variables: tplForm.variables })
      } else {
        await api.notifications.templates.update(tplForm.id, { name: tplForm.name, subject: tplForm.subject, body: tplForm.body, variables: tplForm.variables })
      }
      setShowTplCreate(false); setTplEditing(null); loadTemplates()
    } catch (err) { alert('保存失败: ' + (err as Error).message) }
  }

  const handleTplDelete = async (id: string) => {
    if (!confirm('确定删除此模板？')) return
    try { await api.notifications.templates.delete(id); loadTemplates() }
    catch (err) { alert('删除失败: ' + (err as Error).message) }
  }

  const startTplCreate = () => {
    setTplEditing('new')
    setTplForm({ id: 'tpl_' + Date.now(), name: '', subject: '', body: '', variables: [] })
    setShowTplCreate(true)
  }

  const startTplEdit = (tpl: any) => {
    setTplEditing(tpl.id)
    setTplForm({ id: tpl.id, name: tpl.name, subject: tpl.subject, body: tpl.body, variables: JSON.parse(tpl.variables || '[]') })
    setShowTplCreate(true)
  }

  // ── Wizard ──
  const startWizard = () => { setShowWizard(true); setWizardStep(1); setWizardType('email'); setWizardId(''); setWizardName(''); setWizardConfig({}); setWizardTestResult(null) }

  const wizardNext = () => setWizardStep(s => Math.min(s + 1, 3))
  const wizardPrev = () => setWizardStep(s => Math.max(s - 1, 1))

  const wizardBuildConfig = () => {
    if (wizardType === 'email') return wizardConfig
    if (wizardType === 'feishu_app') return wizardConfig
    return { webhook_url: wizardConfig.webhook_url || '' }
  }

  const wizardCreate = async () => {
    try {
      const config = wizardBuildConfig()
      await api.notifications.channels.create({ id: wizardId, name: wizardName, type: wizardType, config })
      setShowWizard(false); loadChannels()
    } catch (err) { alert('创建失败: ' + (err as Error).message) }
  }

  const wizardTest = async () => {
    setWizardTesting(true); setWizardTestResult(null)
    try {
      const tmpId = 'wizard_test_' + Date.now()
      await api.notifications.channels.create({ id: tmpId, name: 'Wizard Test', type: wizardType, config: wizardBuildConfig() })
      const res = await api.notifications.test(tmpId)
      setWizardTestResult(res.success ? '✅ 测试成功！消息已发送' : '❌ ' + (res.error || '测试失败'))
      await api.notifications.channels.delete(tmpId)
    } catch (err) { setWizardTestResult('❌ ' + (err as Error).message) }
    finally { setWizardTesting(false) }
  }

  // ── Filter channels ──
  const filtered = channels.filter(ch => {
    if (typeFilter && ch.type !== typeFilter) return false
    if (searchQuery && !ch.name.includes(searchQuery) && !ch.id.includes(searchQuery)) return false
    return true
  })

  if (loading) return <div className="settings-empty"><p>加载中...</p></div>

  // ════════════════════════════════════════════
  // Wizard Modal
  // ════════════════════════════════════════════
  const renderWizard = () => (
    <Modal title="新建通知渠道" onClose={() => setShowWizard(false)}>
      <div className="notify-wizard-steps">
        {['选择类型', '填写配置', '测试验证'].map((label, i) => (
          <div key={i} className={`notify-wizard-step ${wizardStep >= i + 1 ? 'active' : ''} ${wizardStep > i + 1 ? 'done' : ''}`}>
            <span className="notify-wizard-step-num">{wizardStep > i + 1 ? '✓' : i + 1}</span>
            <span className="notify-wizard-step-label">{label}</span>
          </div>
        ))}
      </div>

      {wizardStep === 1 && (
        <div className="notify-wizard-types">
          {Object.entries(CHANNEL_TYPES).map(([key, info]) => {
            const Icon = key === 'email' ? Mail : key === 'feishu_app' ? Send : MessageSquare
            return (
              <button key={key} className={`notify-type-card ${wizardType === key ? 'selected' : ''}`} onClick={() => setWizardType(key)}>
                <span className="notify-type-card-icon"><Icon size={24} /></span>
                <span className="notify-type-card-label">{info.label}</span>
                <span className="notify-type-card-desc">{info.desc}</span>
              </button>
            )
          })}
          <div className="notify-wizard-actions">
            <button className="btn btn-ghost" onClick={() => setShowWizard(false)}>取消</button>
            <button className="btn btn-primary" onClick={wizardNext}>下一步</button>
          </div>
        </div>
      )}

      {wizardStep === 2 && (
        <div>
          <FormGroup label="渠道 ID">
            <input className="settings-form-input" value={wizardId} onChange={e => setWizardId(e.target.value)} placeholder="如 feishu-alert" />
          </FormGroup>
          <FormGroup label="渠道名称">
            <input className="settings-form-input" value={wizardName} onChange={e => setWizardName(e.target.value)} placeholder="如 飞书告警通知" />
          </FormGroup>
          {wizardType === 'email' ? (
            <>
              <FormGroup label="SMTP 服务器"><input className="settings-form-input" value={wizardConfig.host || ''} onChange={e => setWizardConfig({ ...wizardConfig, host: e.target.value })} placeholder="smtp.qq.com" /></FormGroup>
              <FormGroup label="端口"><input className="settings-form-input" type="number" value={wizardConfig.port || 587} onChange={e => setWizardConfig({ ...wizardConfig, port: Number(e.target.value) })} /></FormGroup>
              <FormGroup label="发件邮箱"><input className="settings-form-input" value={wizardConfig.user || ''} onChange={e => setWizardConfig({ ...wizardConfig, user: e.target.value })} placeholder="xxx@qq.com" /></FormGroup>
              <FormGroup label="授权码"><input className="settings-form-input" type="password" value={wizardConfig.password || ''} onChange={e => setWizardConfig({ ...wizardConfig, password: e.target.value })} /></FormGroup>
              <FormGroup label="发件人显示"><input className="settings-form-input" value={wizardConfig.from || ''} onChange={e => setWizardConfig({ ...wizardConfig, from: e.target.value })} /></FormGroup>
            </>
          ) : wizardType === 'feishu_app' ? (
            <>
              <FormGroup label="App ID"><input className="settings-form-input" value={wizardConfig.app_id || ''} onChange={e => setWizardConfig({ ...wizardConfig, app_id: e.target.value })} placeholder="cli_a..." /></FormGroup>
              <FormGroup label="App Secret"><input className="settings-form-input" type="password" value={wizardConfig.app_secret || ''} onChange={e => setWizardConfig({ ...wizardConfig, app_secret: e.target.value })} /></FormGroup>
              <FormGroup label="接收人 ID 类型">
                <select className="settings-form-input" value={wizardConfig.receive_id_type || 'open_id'} onChange={e => setWizardConfig({ ...wizardConfig, receive_id_type: e.target.value })}>
                  <option value="open_id">Open ID</option><option value="email">邮箱</option>
                </select>
              </FormGroup>
              <FormGroup label="接收人 ID"><input className="settings-form-input" value={wizardConfig.receive_id || ''} onChange={e => setWizardConfig({ ...wizardConfig, receive_id: e.target.value })} /></FormGroup>
            </>
          ) : (
            <FormGroup label="Webhook URL">
              <input className="settings-form-input" value={wizardConfig.webhook_url || ''} onChange={e => setWizardConfig({ ...wizardConfig, webhook_url: e.target.value })} placeholder={wizardType === 'wecom' ? 'https://qyapi.weixin.qq.com/...' : 'https://open.feishu.cn/...'} />
            </FormGroup>
          )}
          <div className="notify-wizard-actions">
            <button className="btn btn-ghost" onClick={wizardPrev}>上一步</button>
            <button className="btn btn-primary" onClick={wizardNext} disabled={!wizardId || !wizardName}>下一步</button>
          </div>
        </div>
      )}

      {wizardStep === 3 && (
        <div>
          <div className="notify-wizard-test-box">
            <p style={{ margin: 0, fontSize: 13 }}>配置已就绪，点击下方按钮发送测试消息验证渠道是否正常工作。</p>
            <button className="btn btn-primary" onClick={wizardTest} disabled={wizardTesting} style={{ marginTop: 12 }}>
              <Play size={14} /> {wizardTesting ? '测试中...' : '发送测试消息'}
            </button>
            {wizardTestResult && (
              <div className={`notification-test-result ${wizardTestResult.includes('✅') ? 'success' : 'error'}`} style={{ marginTop: 12 }}>
                {wizardTestResult}
              </div>
            )}
          </div>
          <div className="notify-wizard-actions">
            <button className="btn btn-ghost" onClick={wizardPrev}>上一步</button>
            <button className="btn btn-primary" onClick={wizardCreate}>创建渠道</button>
          </div>
        </div>
      )}
    </Modal>
  )

  // ════════════════════════════════════════════
  // Template editor modal
  // ════════════════════════════════════════════
  const renderTplModal = () => (
    <Modal title={tplEditing === 'new' ? '新建模板' : '编辑模板'} onClose={() => { setShowTplCreate(false); setTplEditing(null) }}>
      <div className="notification-form">
        {tplEditing === 'new' && (
          <FormGroup label="模板 ID">
            <input className="settings-form-input" value={tplForm.id} onChange={e => setTplForm({ ...tplForm, id: e.target.value })} placeholder="tpl_my_template" />
          </FormGroup>
        )}
        <FormGroup label="模板名称">
          <input className="settings-form-input" value={tplForm.name} onChange={e => setTplForm({ ...tplForm, name: e.target.value })} placeholder="如：待办提醒" />
        </FormGroup>
        <FormGroup label="默认主题">
          <input className="settings-form-input" value={tplForm.subject} onChange={e => setTplForm({ ...tplForm, subject: e.target.value })} />
        </FormGroup>
        <FormGroup label="消息正文">
          <textarea className="settings-form-input" rows={6} value={tplForm.body} onChange={e => setTplForm({ ...tplForm, body: e.target.value })} placeholder="使用 {{变量名}} 插入动态内容" />
        </FormGroup>
        <p className="text-muted">提示：使用 {'{{'}变量名{'}}'} 插入动态内容，发送时可替换</p>
        <div className="settings-form-actions">
          <button className="btn btn-primary" onClick={handleTplSave}>保存</button>
          <button className="btn btn-ghost" onClick={() => { setShowTplCreate(false); setTplEditing(null) }}>取消</button>
        </div>
      </div>
    </Modal>
  )

  // ════════════════════════════════════════════
  // Config Tab
  // ════════════════════════════════════════════
  const renderConfigTab = () => (
    <div className="notification-editor-body">
      <FormGroup label="渠道名称">
        <input className="settings-form-input" value={formName} onChange={e => setFormName(e.target.value)} />
      </FormGroup>

      {formType === 'email' ? (
        <>
          <div className="notification-config-grid">
            <FormGroup label="SMTP 服务器"><input className="settings-form-input" value={emailHost} onChange={e => setEmailHost(e.target.value)} /></FormGroup>
            <FormGroup label="端口"><input className="settings-form-input" type="number" value={emailPort} onChange={e => setEmailPort(Number(e.target.value))} style={{ width: 100 }} /></FormGroup>
          </div>
          <FormGroup label="发件邮箱"><input className="settings-form-input" value={emailUser} onChange={e => setEmailUser(e.target.value)} /></FormGroup>
          <FormGroup label="授权码/密码"><input className="settings-form-input" type="password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)} /></FormGroup>
          <FormGroup label="发件人显示"><input className="settings-form-input" value={emailFrom} onChange={e => setEmailFrom(e.target.value)} /></FormGroup>
          <label className="checkbox-label"><input type="checkbox" checked={emailSecure} onChange={e => setEmailSecure(e.target.checked)} /><span>使用 SSL/TLS</span></label>
        </>
      ) : formType === 'feishu_app' ? (
        <>
          <FormGroup label="App ID"><input className="settings-form-input" value={feishuAppId} onChange={e => setFeishuAppId(e.target.value)} /></FormGroup>
          <FormGroup label="App Secret"><input className="settings-form-input" type="password" value={feishuAppSecret} onChange={e => setFeishuAppSecret(e.target.value)} /></FormGroup>
          <FormGroup label="接收人 ID 类型">
            <select className="settings-form-input" value={feishuReceiveIdType} onChange={e => setFeishuReceiveIdType(e.target.value)}>
              <option value="open_id">Open ID</option><option value="email">邮箱</option>
            </select>
          </FormGroup>
          <FormGroup label="接收人 ID"><input className="settings-form-input" value={feishuReceiveId} onChange={e => setFeishuReceiveId(e.target.value)} /></FormGroup>
        </>
      ) : (
        <FormGroup label="Webhook URL"><input className="settings-form-input" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} /></FormGroup>
      )}

      <FormGroup label="启用">
        <label className="settings-toggle-wrap">
          <input type="checkbox" checked={formEnabled} onChange={e => setFormEnabled(e.target.checked)} />
          <span className="settings-toggle-slider" />
          <span className="settings-toggle-label">启用后该通知渠道可正常发送消息</span>
        </label>
      </FormGroup>

      <div className="notification-test-section">
        <h4 className="notification-test-title">测试发送</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={handleTest} disabled={testing} style={{ height: 28, fontSize: 11 }}>
            <Play size={12} /> {testing ? '发送中...' : '发送测试消息'}
          </button>
        </div>
        {testResult && <div className={`notification-test-result ${testResult.includes('✅') ? 'success' : 'error'}`}>{testResult}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 12, marginTop: 8 }}>
        <button className="btn btn-danger-outline" onClick={() => handleDelete(selectedChannel?.id)} disabled={!selectedChannel} style={{ fontSize: 11 }}>
          <Trash2 size={12} /> 删除此渠道
        </button>
      </div>
    </div>
  )

  // ════════════════════════════════════════════
  // Send Tab
  // ════════════════════════════════════════════
  const renderSendTab = () => (
    <div className="notification-editor-body">
      {(formType === 'feishu_app' || formType === 'email') && (
        <FormGroup label={formType === 'email' ? '收件人邮箱' : '接收人 ID'}>
          <input className="settings-form-input" value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder={formType === 'email' ? 'admin@example.com' : 'ou_xxx'} />
        </FormGroup>
      )}

      <FormGroup label="消息模板">
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="settings-form-input" value={sendTemplateId} onChange={e => {
            setSendTemplateId(e.target.value)
            const tpl = templates.find(t => t.id === e.target.value)
            if (tpl) pickTemplate(tpl)
          }} style={{ flex: 1 }}>
            <option value="">-- 不使用模板 --</option>
            {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </FormGroup>

      <FormGroup label="主题">
        <input className="settings-form-input" value={sendSubject} onChange={e => setSendSubject(e.target.value)} placeholder="消息主题" />
      </FormGroup>

      <FormGroup label="消息内容">
        <textarea className="settings-form-input" rows={6} value={sendBody} onChange={e => setSendBody(e.target.value)} placeholder="输入消息内容..." />
      </FormGroup>

      <button className="btn btn-primary" onClick={handleSend} disabled={sending || !sendBody} style={{ width: 'fit-content' }}>
        <Send size={14} /> {sending ? '发送中...' : '发送消息'}
      </button>

      {sendResult && <div className={`notification-test-result ${sendResult.includes('✅') ? 'success' : 'error'}`}>{sendResult}</div>}
    </div>
  )

  // ════════════════════════════════════════════
  // Templates Tab
  // ════════════════════════════════════════════
  const renderTemplatesTab = () => (
    <div className="notification-editor-body">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 className="notification-test-title" style={{ margin: 0 }}>消息模板</h4>
        <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} onClick={startTplCreate}><Plus size={12} /> 新建</button>
      </div>
      <p className="text-muted">模板用于快捷发送，可在发送 Tab 中直接选用。</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.map((tpl: any) => (
          <div key={tpl.id} className="notify-tpl-card">
            <div className="notify-tpl-card-body" onClick={() => { pickTemplate(tpl); setActiveTab('send') }}>
              <span className="notify-tpl-card-name">{tpl.name}</span>
              <span className="notify-tpl-card-subject">{tpl.subject || '(无主题)'}</span>
              <span className="notify-tpl-card-preview">{tpl.body?.substring(0, 80)}{(tpl.body?.length || 0) > 80 ? '...' : ''}</span>
            </div>
            <div className="notify-tpl-card-actions">
              <button className="btn btn-ghost" style={{ height: 22, width: 22, padding: 0 }} onClick={() => startTplEdit(tpl)}><Pencil size={11} /></button>
              <button className="btn btn-ghost" style={{ height: 22, width: 22, padding: 0 }} onClick={() => handleTplDelete(tpl.id)}><Trash2 size={11} /></button>
            </div>
          </div>
        ))}
        {templates.length === 0 && <div className="settings-empty" style={{ padding: 24 }}><p style={{ fontSize: 13 }}>暂无模板</p></div>}
      </div>
    </div>
  )

  // ════════════════════════════════════════════
  // Logs Tab
  // ════════════════════════════════════════════
  const renderLogsTab = () => (
    <div className="notification-editor-body">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <select className="settings-form-input" value={logsFilterSuccess === undefined ? '' : String(logsFilterSuccess)} onChange={e => {
          setLogsFilterSuccess(e.target.value === '' ? undefined : Number(e.target.value))
          setLogsPage(1)
        }} style={{ width: 120 }}>
          <option value="">全部状态</option>
          <option value="1">成功</option>
          <option value="0">失败</option>
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {logs.map((log: any) => (
          <div key={log.id} className="notify-log-item" onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}>
            <div className="notify-log-item-header">
              <span className={`notify-log-badge ${log.success ? 'success' : 'error'}`}>{log.success ? '✓' : '✗'}</span>
              <span className="notify-log-channel">{log.channel_name || log.channel_id}</span>
              <span className="notify-log-subject">{log.subject || log.message?.substring(0, 40)}</span>
              <span className="notify-log-time">{new Date(log.created_at).toLocaleString()}</span>
            </div>
            {expandedLogId === log.id && (
              <div className="notify-log-detail">
                <pre>{JSON.stringify(log, null, 2)}</pre>
              </div>
            )}
          </div>
        ))}
        {logs.length === 0 && <div className="settings-empty" style={{ padding: 24 }}><p style={{ fontSize: 13 }}>暂无日志</p></div>}
      </div>
      {logsTotal > 20 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} disabled={logsPage <= 1} onClick={() => setLogsPage(p => p - 1)}>上一页</button>
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{logsPage} / {Math.ceil(logsTotal / 20)}</span>
          <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }} disabled={logsPage >= Math.ceil(logsTotal / 20)} onClick={() => setLogsPage(p => p + 1)}>下一页</button>
        </div>
      )}
    </div>
  )

  // ════════════════════════════════════════════
  // Main render
  // ════════════════════════════════════════════
  return (
    <div className="notification-panel">
      {/* Channel list (left sidebar) */}
      <div className="notification-channel-list">
        <div className="notification-channel-list-header">
          <h3 className="notification-channel-list-title">通知渠道</h3>
          <button className="btn btn-primary" style={{ height: 26, fontSize: 11 }} onClick={startWizard}><Plus size={12} /> 新建</button>
        </div>
        {channels.length > 0 && (
          <div className="notification-channel-filters">
            <select className="settings-form-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ fontSize: 11 }}>
              <option value="">全部类型</option>
              {Object.entries(CHANNEL_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input className="settings-form-input" placeholder="搜索..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ fontSize: 11 }} />
          </div>
        )}
        <div className="notification-channel-items">
          {filtered.map((ch: any) => (
            <button key={ch.id} className={`notification-channel-item ${selectedChannel?.id === ch.id ? 'active' : ''}`} onClick={() => selectChannel(ch)}>
              <span className="notification-channel-item-type">
                {ch.type === 'email' ? <Mail size={14} /> : ch.type === 'feishu_app' ? <Send size={14} /> : <MessageSquare size={14} />}
              </span>
              <span className="notification-channel-item-info">
                <span className="notification-channel-item-name">{ch.name}</span>
                <span className="notification-channel-item-id">{ch.id}</span>
              </span>
              <span className={`notification-channel-item-status ${channelHealth[ch.id] === 'healthy' ? 'healthy' : channelHealth[ch.id] === 'unhealthy' ? 'unhealthy' : ''}`} />
            </button>
          ))}
          {filtered.length === 0 && channels.length > 0 && (
            <div className="settings-empty" style={{ padding: 24 }}><p style={{ fontSize: 13 }}>无匹配渠道</p></div>
          )}
          {channels.length === 0 && (
            <div className="settings-empty" style={{ padding: 32 }}>
              <Bell size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>暂无通知渠道</p>
              <button className="btn btn-primary" style={{ marginTop: 12, height: 26, fontSize: 11 }} onClick={startWizard}><Plus size={12} /> 创建第一个通知渠道</button>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel (right) */}
      <div className="notification-detail">
        {selectedChannel ? (
          <>
            <div className="notification-detail-header">
              <div className="notification-detail-header-left">
                <h3 className="notification-detail-title">{selectedChannel.name}</h3>
                <span className="notification-detail-type">{CHANNEL_TYPES[selectedChannel.type]?.label || selectedChannel.type}</span>
                <span className={`notification-detail-health ${channelHealth[selectedChannel.id] === 'healthy' ? 'healthy' : 'unhealthy'}`}>
                  {channelHealth[selectedChannel.id] === 'healthy' ? '正常' : channelHealth[selectedChannel.id] === 'unhealthy' ? '异常' : '未知'}
                </span>
              </div>
              <div className="notification-detail-header-right">
                <div className="notification-detail-tabs">
                  {[
                    { key: 'config', label: '配置' },
                    { key: 'send', label: '发送' },
                    { key: 'templates', label: '模板' },
                    { key: 'logs', label: '日志' },
                  ].map(tab => (
                    <button key={tab.key} className={`notification-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                  <button className="btn btn-primary" style={{ height: 26, fontSize: 11 }} onClick={handleSave} disabled={saving}>
                    <Save size={12} /> {saving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
            <div className="notification-detail-body">
              {activeTab === 'config' && renderConfigTab()}
              {activeTab === 'send' && renderSendTab()}
              {activeTab === 'templates' && renderTemplatesTab()}
              {activeTab === 'logs' && renderLogsTab()}
            </div>
          </>
        ) : (
          <div className="settings-empty" style={{ flex: 1 }}>
            <Bell size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>选择一个通知渠道</p>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>或点击「新建」创建通知渠道</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showWizard && renderWizard()}
      {showTplCreate && renderTplModal()}
    </div>
  )
}

function ToolConfigPanel() {
  const [tools, setTools] = useState<ToolConfig[]>([])
  const [selectedTool, setSelectedTool] = useState<ToolConfig | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [descOverride, setDescOverride] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [filterSource, setFilterSource] = useState<'all' | 'built-in' | 'mcp'>('all')

  const loadTools = useCallback(() => {
    api.agent.tools()
      .then((res) => setTools(res.tools))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadTools()
  }, [loadTools])

  const selectTool = (tool: ToolConfig) => {
    setSelectedTool(tool)
    setEnabled(tool.enabled)
    setDescOverride(tool.description)
  }

  const handleSave = async () => {
    if (!selectedTool) return
    setSaving(true)
    setSaved(false)
    try {
      await api.agent.saveTool(selectedTool.name, {
        enabled,
        description: descOverride !== selectedTool.description ? descOverride : undefined,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      loadTools()
    } catch (err) {
      alert('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (tool: ToolConfig) => {
    try {
      await api.agent.saveTool(tool.name, { enabled: !tool.enabled })
      loadTools()
      if (selectedTool?.name === tool.name) {
        setEnabled(!tool.enabled)
      }
    } catch (err) {
      alert('操作失败: ' + (err as Error).message)
    }
  }

  const isModified = selectedTool && (enabled !== selectedTool.enabled || descOverride !== selectedTool.description)

  const filteredTools = filterSource === 'all' ? tools : tools.filter((t) => t.source === filterSource)
  const builtinCount = tools.filter((t) => t.source === 'built-in').length
  const mcpCount = tools.filter((t) => t.source === 'mcp').length

  if (loading) return <div className="settings-empty"><p>加载中...</p></div>

  return (
    <div className="skill-config">
      <div className="skill-sidebar">
        <div className="skill-sidebar-header">
          <span className="skill-sidebar-title">工具</span>
          <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>{tools.length} 个工具</span>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px' }}>
          {(['all', 'built-in', 'mcp'] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-ghost`}
              style={{ height: 22, fontSize: 10, fontWeight: filterSource === f ? 600 : 400, background: filterSource === f ? 'var(--color-surface-hover)' : undefined }}
              onClick={() => setFilterSource(f)}
            >
              {f === 'all' ? '全部' : f === 'built-in' ? `内置 (${builtinCount})` : `MCP (${mcpCount})`}
            </button>
          ))}
        </div>
        <div className="skill-list">
          {filteredTools.map((t) => (
            <div
              key={t.name}
              className={`skill-list-item ${selectedTool?.name === t.name ? 'active' : ''}`}
              onClick={() => selectTool(t)}
            >
              <span className={`skill-list-icon ${t.enabled ? 'ai-purple' : 'ai-orange'}`}>
                <Wrench size={11} strokeWidth={2.5} />
              </span>
              <div className="skill-list-body">
                <div className="skill-list-name">{t.name}</div>
                <div className="skill-list-id">
                  <span className={`hook-event-badge ${t.source === 'mcp' ? 'green' : ''}`}>{t.source === 'built-in' ? '内置' : 'MCP'}</span>
                  {!t.enabled && <span className="hook-disabled-badge">已禁用</span>}
                </div>
              </div>
              <button
                className={`icon-btn-sm ${t.enabled ? '' : 'primary'}`}
                title={t.enabled ? '禁用' : '启用'}
                onClick={(e) => { e.stopPropagation(); toggleEnabled(t) }}
              >
                {t.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              </button>
            </div>
          ))}
          {filteredTools.length === 0 && <div className="skill-list-empty">暂无工具</div>}
        </div>
      </div>

      <div className="skill-editor">
        {selectedTool ? (
          <>
            <div className="skill-editor-header">
              <span className="skill-editor-title">
                <span className={`skill-list-icon ${enabled ? 'ai-purple' : 'ai-orange'}`}>
                  <Wrench size={12} strokeWidth={2.5} />
                </span>
                {selectedTool.name}
                <span className={`hook-event-badge ${selectedTool.source === 'mcp' ? 'green' : ''}`} style={{ marginLeft: 8 }}>
                  {selectedTool.source === 'built-in' ? '内置' : 'MCP'}
                </span>
              </span>
              <div className="skill-editor-actions">
                {isModified && <span style={{ color: 'var(--color-warning)', fontSize: 11 }}>已修改</span>}
                {saved && <span style={{ color: 'var(--color-success)', fontSize: 11, fontWeight: 500 }}>已保存</span>}
                <button className="btn btn-primary" style={{ height: 28, fontSize: 11 }} onClick={handleSave} disabled={saving || !isModified}>
                  <Save size={12} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>

            <div className="settings-form" style={{ padding: 16 }}>
              <FormGroup label="启用状态">
                <label className="toggle-row">
                  <span>{enabled ? '已启用 — Agent 可以使用此工具' : '已禁用 — Agent 不可使用此工具'}</span>
                  <button
                    className={`toggle-btn ${enabled ? 'on' : 'off'}`}
                    onClick={() => setEnabled(!enabled)}
                  >
                    {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                </label>
              </FormGroup>

              <FormGroup label="工具名称">
                <code style={{ padding: '4px 8px', background: 'var(--color-surface-hover)', borderRadius: 4, fontSize: 13 }}>
                  {selectedTool.name}
                </code>
              </FormGroup>

              <FormGroup label="来源">
                <span>
                  {selectedTool.source === 'built-in' ? '内置工具（系统预置）' : `MCP 工具${selectedTool.mcpServer ? ` (${selectedTool.mcpServer})` : ''}`}
                </span>
              </FormGroup>

              <FormGroup label="描述">
                <textarea
                  className="settings-textarea code-font"
                  style={{ minHeight: 60 }}
                  value={descOverride}
                  onChange={(e) => setDescOverride(e.target.value)}
                />
              </FormGroup>

              {selectedTool.parameters && (
                <FormGroup label="参数 Schema">
                  <pre className="settings-code-block" style={{ maxHeight: 300, overflow: 'auto', fontSize: 11 }}>
                    {JSON.stringify(selectedTool.parameters, null, 2)}
                  </pre>
                </FormGroup>
              )}
            </div>
          </>
        ) : (
          <div className="skill-editor-empty">选择一个工具查看详情</div>
        )}
      </div>
    </div>
  )
}

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-form-group">
      <label className="settings-form-label">{label}</label>
      {children}
    </div>
  )
}
