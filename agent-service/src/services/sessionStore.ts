import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { Session, CompactionConfig, CompactionResult, TodoItem } from '../types'

const DB_PATH = process.env.AGENT_DB_PATH || path.join(process.cwd(), 'data', 'agent-sessions.db')

const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  preserveRecentMessages: parseInt(process.env.COMPACTION_PRESERVE_RECENT || '4', 10),
  maxEstimatedTokens: parseInt(process.env.COMPACTION_MAX_ESTIMATED_TOKENS || '10000', 10),
  triggerTokenThreshold: parseInt(process.env.COMPACTION_TRIGGER_TOKENS || '100000', 10),
  maxSummaryChars: 2000,
  maxSummaryLines: 40,
  maxLineChars: 200,
}

const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '24', 10)
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '1000', 10)
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '5', 10)

type SummarizeFn = (messages: Session['messages'], previousSummary?: string) => Promise<string>

export class SessionStore {
  private db: Database.Database
  private config: CompactionConfig
  private cleanupJob: any = null
  private sessionsRef: Map<string, Session> | null = null

  constructor(dbPath?: string, config?: Partial<CompactionConfig>) {
    const resolvedPath = dbPath || DB_PATH
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config }
    this.initSchema()
  }

  setSessionsRef(ref: Map<string, Session>): void {
    this.sessionsRef = ref
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        work_dir TEXT DEFAULT '',
        cumulative_input_tokens INTEGER DEFAULT 0,
        compaction_count INTEGER DEFAULT 0,
        last_compacted_at TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_session ON agent_sessions(session_id);

      CREATE TABLE IF NOT EXISTS agent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool','compaction')),
        content TEXT DEFAULT '',
        reasoning_content TEXT DEFAULT '',
        tool_call_id TEXT DEFAULT '',
        tool_calls_json TEXT DEFAULT '',
        seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_key, seq);

      CREATE TABLE IF NOT EXISTS agent_compactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        removed_message_count INTEGER NOT NULL,
        summary_text TEXT NOT NULL,
        input_tokens_before INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_compactions_session ON agent_compactions(session_key);

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        content TEXT DEFAULT '',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
        blocked_by_json TEXT DEFAULT '[]',
        verified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id, task_id);

      -- Token usage tracking (project-level, like Claude Code /cost)
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        model_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        cached_prompt_tokens INTEGER DEFAULT 0,
        uncached_prompt_tokens INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_key);
      CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(created_at);

      CREATE TABLE IF NOT EXISTS token_daily_summary (
        date TEXT PRIMARY KEY,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        request_count INTEGER DEFAULT 0,
        session_count INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `)

    // Migration: add reasoning_content column for existing databases
    let columns = this.db.prepare("PRAGMA table_info(agent_messages)").all() as any[]
    if (!columns.some((c: any) => c.name === 'reasoning_content')) {
      this.db.exec("ALTER TABLE agent_messages ADD COLUMN reasoning_content TEXT DEFAULT ''")
    }

    // Migration: add columns to token_daily_summary for older databases
    columns = this.db.prepare("PRAGMA table_info(token_daily_summary)").all() as any[]
    if (!columns.some((c: any) => c.name === 'total_tokens')) {
      this.db.exec("ALTER TABLE token_daily_summary ADD COLUMN total_tokens INTEGER DEFAULT 0")
    }
    if (!columns.some((c: any) => c.name === 'session_count')) {
      this.db.exec("ALTER TABLE token_daily_summary ADD COLUMN session_count INTEGER DEFAULT 0")
    }

    // Migration: add user_id and cache columns to token_usage for older databases
    columns = this.db.prepare("PRAGMA table_info(token_usage)").all() as any[]
    if (!columns.some((c: any) => c.name === 'user_id')) {
      this.db.exec("ALTER TABLE token_usage ADD COLUMN user_id TEXT NOT NULL DEFAULT ''")
    }
    if (!columns.some((c: any) => c.name === 'cached_prompt_tokens')) {
      this.db.exec("ALTER TABLE token_usage ADD COLUMN cached_prompt_tokens INTEGER DEFAULT 0")
    }
    if (!columns.some((c: any) => c.name === 'uncached_prompt_tokens')) {
      this.db.exec("ALTER TABLE token_usage ADD COLUMN uncached_prompt_tokens INTEGER DEFAULT 0")
    }
    // Create index on user_id after column migration
    try {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(user_id)")
    } catch { /* index may already exist */ }
  }

  // ── Session CRUD ──

  createSession(key: string, sessionId: string, skillId: string, systemPrompt: string): Session {
    const workDir = path.join(os.tmpdir(), 'agent-session', sessionId)
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true })
    }

    const now = Date.now()
    const session: Session = {
      id: sessionId,
      skillId,
      messages: [{ role: 'system', content: systemPrompt }],
      createdAt: now,
      updatedAt: now,
      workDir,
      cumulativeInputTokens: 0,
      compactionCount: 0,
    }

    this.db.prepare(`
      INSERT OR IGNORE INTO agent_sessions (id, session_id, skill_id, work_dir, cumulative_input_tokens, compaction_count)
      VALUES (?, ?, ?, ?, 0, 0)
    `).run(key, sessionId, skillId, workDir)

    this.syncMessagesToDb(key, session.messages)

    return session
  }

  getSession(key: string): Session | null {
    const row = this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(key) as any
    if (!row) return null

    const messages = this.loadMessages(key)
    return {
      id: row.session_id,
      skillId: row.skill_id,
      messages,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      workDir: row.work_dir || '',
      cumulativeInputTokens: row.cumulative_input_tokens || 0,
      compactionCount: row.compaction_count || 0,
    }
  }

  updateSessionTimestamp(key: string): void {
    this.db.prepare(`UPDATE agent_sessions SET updated_at = datetime('now','localtime') WHERE id = ?`).run(key)
  }

  deleteSession(key: string): void {
    this.db.prepare('DELETE FROM agent_messages WHERE session_key = ?').run(key)
    this.db.prepare('DELETE FROM agent_compactions WHERE session_key = ?').run(key)
    this.db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(key)
  }

  // ── Message operations ──

  appendMessage(key: string, message: Session['messages'][0]): void {
    const maxSeq = this.db.prepare(
      'SELECT COALESCE(MAX(seq), -1) as max_seq FROM agent_messages WHERE session_key = ?'
    ).get(key) as any

    const seq = (maxSeq?.max_seq ?? -1) + 1
    const role = message.role
    const content = this.truncateField(message.content)
    const reasoningContent = message.reasoningContent || ''
    const toolCallId = message.toolCallId || ''
    const toolCallsJson = message.toolCalls ? JSON.stringify(message.toolCalls) : ''

    this.db.prepare(`
      INSERT INTO agent_messages (session_key, role, content, reasoning_content, tool_call_id, tool_calls_json, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(key, role, content, reasoningContent, toolCallId, toolCallsJson, seq)

    this.updateSessionTimestamp(key)
  }

  loadMessages(key: string): Session['messages'] {
    const rows = this.db.prepare(
      'SELECT role, content, reasoning_content, tool_call_id, tool_calls_json FROM agent_messages WHERE session_key = ? ORDER BY seq ASC'
    ).all(key) as any[]

    return rows.map(row => {
      const msg: Session['messages'][0] = {
        role: row.role as Session['messages'][0]['role'],
        content: row.content,
      }
      if (row.reasoning_content) {
        msg.reasoningContent = row.reasoning_content
      }
      if (row.tool_call_id) {
        msg.toolCallId = row.tool_call_id
      }
      if (row.tool_calls_json) {
        try {
          msg.toolCalls = JSON.parse(row.tool_calls_json)
        } catch { /* ignore */ }
      }
      return msg
    })
  }

  getMessageCount(key: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM agent_messages WHERE session_key = ?').get(key) as any
    return row?.c || 0
  }

  // ── Token tracking ──

  addInputTokens(key: string, tokens: number): void {
    this.db.prepare(
      'UPDATE agent_sessions SET cumulative_input_tokens = cumulative_input_tokens + ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ).run(tokens, key)
  }

  getCumulativeInputTokens(key: string): number {
    const row = this.db.prepare('SELECT cumulative_input_tokens FROM agent_sessions WHERE id = ?').get(key) as any
    return row?.cumulative_input_tokens || 0
  }

  resetInputTokens(key: string): void {
    this.db.prepare(
      'UPDATE agent_sessions SET cumulative_input_tokens = 0, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ).run(key)
  }

  // ── Token usage tracking (project-level, like Claude Code /cost) ──

  recordTokenUsage(
    key: string, sessionId: string, modelId: string, userId: string,
    promptTokens: number, completionTokens: number,
    cachedPromptTokens: number = 0, uncachedPromptTokens: number = 0,
  ): void {
    if (promptTokens <= 0 && completionTokens <= 0) return
    const today = new Date().toISOString().slice(0, 10)
    const insertUsage = this.db.prepare(
      'INSERT INTO token_usage (session_key, session_id, model_id, user_id, prompt_tokens, completion_tokens, cached_prompt_tokens, uncached_prompt_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    // Check if this session_key has been seen today BEFORE inserting — the insert
    // happens inside the transaction AFTER this check, so it correctly detects
    // brand-new sessions vs repeat requests from the same session.
    const isNewSessionToday = this.db.prepare(
      'SELECT COUNT(*) as c FROM token_usage WHERE session_key = ? AND date(created_at) = ?'
    ).get(key, today) as any
    const sessionCountIncrement = (isNewSessionToday?.c || 0) === 0 ? 1 : 0
    const upsertDaily = this.db.prepare(`
      INSERT INTO token_daily_summary (date, prompt_tokens, completion_tokens, total_tokens, request_count, session_count)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(date) DO UPDATE SET
        prompt_tokens = prompt_tokens + ?,
        completion_tokens = completion_tokens + ?,
        total_tokens = total_tokens + ?,
        request_count = request_count + 1,
        session_count = session_count + ?,
        updated_at = datetime('now','localtime')
    `)
    const totalTokens = promptTokens + completionTokens
    const doRecord = this.db.transaction(() => {
      insertUsage.run(key, sessionId, modelId, userId || '', promptTokens, completionTokens, cachedPromptTokens, uncachedPromptTokens)
      upsertDaily.run(today, promptTokens, completionTokens, totalTokens, sessionCountIncrement,
        promptTokens, completionTokens, totalTokens, sessionCountIncrement)
    })
    doRecord()
  }

  getUsageSummary(userId?: string): {
    today: { prompt: number; completion: number; total: number; requests: number; sessions: number }
    week: { prompt: number; completion: number; total: number; requests: number }
    allTime: { prompt: number; completion: number; total: number; requests: number; sessions: number; cachedPrompt: number; uncachedPrompt: number }
  } {
    const today = new Date().toISOString().slice(0, 10)
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const userFilter = userId ? 'WHERE user_id = ?' : ''
    const userParam = userId ? [userId] : []

    // Today/week use aggregated daily_summary (not user-filtered for now — daily rollup stays global)
    const todayRow = this.db.prepare(
      'SELECT prompt_tokens, completion_tokens, total_tokens, request_count, session_count FROM token_daily_summary WHERE date = ?'
    ).get(today) as any

    const weekRows = this.db.prepare(
      'SELECT SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion, SUM(total_tokens) as total, SUM(request_count) as requests FROM token_daily_summary WHERE date >= ?'
    ).get(weekStart) as any

    // All-time from token_usage, optionally filtered by user
    const allRows = this.db.prepare(
      `SELECT SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion, SUM(prompt_tokens + completion_tokens) as total, COUNT(*) as requests, COUNT(DISTINCT session_id) as sessions, SUM(cached_prompt_tokens) as cachedPrompt, SUM(uncached_prompt_tokens) as uncachedPrompt FROM token_usage ${userFilter}`
    ).get(...userParam) as any

    return {
      today: {
        prompt: todayRow?.prompt_tokens || 0,
        completion: todayRow?.completion_tokens || 0,
        total: todayRow?.total_tokens || 0,
        requests: todayRow?.request_count || 0,
        sessions: todayRow?.session_count || 0,
      },
      week: {
        prompt: weekRows?.prompt || 0,
        completion: weekRows?.completion || 0,
        total: weekRows?.total || 0,
        requests: weekRows?.requests || 0,
      },
      allTime: {
        prompt: allRows?.prompt || 0,
        completion: allRows?.completion || 0,
        total: allRows?.total || 0,
        requests: allRows?.requests || 0,
        sessions: allRows?.sessions || 0,
        cachedPrompt: allRows?.cachedPrompt || 0,
        uncachedPrompt: allRows?.uncachedPrompt || 0,
      },
    }
  }

  getDailyUsage(days: number = 14, userId?: string): Array<{ date: string; prompt: number; completion: number; total: number; requests: number }> {
    const userFilter = userId ? 'WHERE user_id = ?' : ''
    const params = userId ? [userId, days] : [days]
    return this.db.prepare(
      `SELECT date, SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion, SUM(prompt_tokens + completion_tokens) as total, COUNT(*) as requests FROM token_usage ${userFilter} GROUP BY date ORDER BY date DESC LIMIT ?`
    ).all(...params) as any[]
  }

  getModelUsage(userId?: string): Array<{ model: string; prompt: number; completion: number; total: number; requests: number }> {
    const userFilter = userId ? 'WHERE user_id = ?' : ''
    const params = userId ? [userId] : []
    return this.db.prepare(
      `SELECT model_id as model, SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion, SUM(prompt_tokens + completion_tokens) as total, COUNT(*) as requests FROM token_usage ${userFilter} GROUP BY model_id ORDER BY total DESC`
    ).all(...params) as any[]
  }

  // ── Task persistence ──

  saveTasks(sessionId: string, tasks: Array<{ id: string; content: string; status: string; blockedBy?: string[]; verified?: boolean }>): void {
    const del = this.db.prepare('DELETE FROM agent_tasks WHERE session_id = ?')
    const ins = this.db.prepare(
      'INSERT INTO agent_tasks (session_id, task_id, content, status, blocked_by_json, verified) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const tx = this.db.transaction(() => {
      del.run(sessionId)
      for (const t of tasks) {
        ins.run(sessionId, t.id, t.content, t.status, JSON.stringify(t.blockedBy || []), t.verified === undefined ? null : (t.verified ? 1 : 0))
      }
    })
    tx()
  }

  loadTasks(sessionId: string): TodoItem[] {
    const rows = this.db.prepare(
      'SELECT task_id, content, status, blocked_by_json, verified FROM agent_tasks WHERE session_id = ? ORDER BY id ASC'
    ).all(sessionId) as any[]
    return rows.map(r => ({
      id: r.task_id,
      content: r.content,
      status: r.status as TodoItem['status'],
      blockedBy: JSON.parse(r.blocked_by_json || '[]'),
      verified: r.verified === null ? undefined : r.verified === 1,
    }))
  }

  // ── Compaction ──

  shouldCompact(key: string): boolean {
    const tokens = this.getCumulativeInputTokens(key)
    return tokens >= this.config.triggerTokenThreshold
  }

  async compactSession(key: string, summarizeFn?: SummarizeFn): Promise<CompactionResult> {
    const messages = this.loadMessages(key)
    const config = this.config

    // Find existing compaction summary
    const compactionIdx = messages.findIndex(m => m.role === 'system' && m.content.startsWith(COMPACT_PREAMBLE))
    const compactedPrefixLen = compactionIdx >= 0 ? 1 : 0

    // Determine compactable region
    const rawKeepFrom = Math.max(compactedPrefixLen, messages.length - config.preserveRecentMessages)

    // Boundary protection: don't split tool_use/tool_result pairs
    let keepFrom = rawKeepFrom
    while (keepFrom > compactedPrefixLen) {
      const firstPreserved = messages[keepFrom]
      if (firstPreserved.role === 'tool') {
        const preceding = messages[keepFrom - 1]
        const precedingHasToolCalls = preceding.toolCalls && preceding.toolCalls.length > 0
        if (precedingHasToolCalls) {
          keepFrom--
          break
        }
        keepFrom--
      } else {
        break
      }
    }

    const compactableMessages = messages.slice(compactedPrefixLen, keepFrom)
    if (compactableMessages.length <= config.preserveRecentMessages) {
      return { removedCount: 0, summaryLength: 0, newMessageCount: messages.length }
    }

    const existingSummary = compactionIdx >= 0
      ? messages[compactionIdx].content.replace(COMPACT_PREAMBLE, '').trim()
      : undefined

    // Generate summary
    let summary: string
    if (summarizeFn) {
      try {
        summary = await summarizeFn(compactableMessages, existingSummary)
      } catch (err) {
        console.error('[SessionStore] LLM summarization failed, using heuristic fallback:', err)
        summary = this.heuristicSummarize(compactableMessages, existingSummary)
      }
    } else {
      summary = this.heuristicSummarize(compactableMessages, existingSummary)
    }

    // Compress summary if too long
    summary = this.compressSummary(summary)

    const formattedSummary = `${COMPACT_PREAMBLE}${summary}\n\n${COMPACT_RECENT_NOTE}`

    const preserved = messages.slice(keepFrom)
    const newMessages: Session['messages'] = [
      { role: 'system', content: formattedSummary },
      ...preserved,
    ]

    // Write to DB in a transaction
    const sessionRow = this.db.prepare('SELECT cumulative_input_tokens, compaction_count FROM agent_sessions WHERE id = ?').get(key) as any
    const inputTokensBefore = sessionRow?.cumulative_input_tokens || 0
    const compactionCount = (sessionRow?.compaction_count || 0) + 1

    const doCompact = this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_messages WHERE session_key = ?').run(key)
      this.syncMessagesToDb(key, newMessages)

      this.db.prepare(`
        UPDATE agent_sessions SET
          cumulative_input_tokens = 0,
          compaction_count = ?,
          last_compacted_at = datetime('now','localtime'),
          updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(compactionCount, key)

      this.db.prepare(`
        INSERT INTO agent_compactions (session_key, removed_message_count, summary_text, input_tokens_before)
        VALUES (?, ?, ?, ?)
      `).run(key, compactableMessages.length, summary, inputTokensBefore)
    })

    doCompact()

    // Sync in-memory session if available
    if (this.sessionsRef?.has(key)) {
      const session = this.sessionsRef.get(key)!
      session.messages = newMessages
      session.cumulativeInputTokens = 0
      session.compactionCount = compactionCount
    }

    console.log(`[SessionStore] Compacted session ${key}: removed ${compactableMessages.length} messages, summary ${summary.length} chars`)

    return {
      removedCount: compactableMessages.length,
      summaryLength: summary.length,
      newMessageCount: newMessages.length,
    }
  }

  // ── Heuristic summarization (Claude Code compatible) ──

  private heuristicSummarize(messages: Session['messages'], existingSummary?: string): string {
    const userCount = messages.filter(m => m.role === 'user').length
    const assistantCount = messages.filter(m => m.role === 'assistant').length
    const toolCount = messages.filter(m => m.role === 'tool').length

    // Extract tool names
    const toolNames = new Set<string>()
    for (const m of messages) {
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          toolNames.add(tc.function.name)
        }
      }
    }
    const sortedTools = Array.from(toolNames).sort()

    const lines: string[] = [
      '1. Primary Request and Intent:',
      `- ${messages.length} messages compacted (user=${userCount}, assistant=${assistantCount}, tool=${toolCount}).`,
    ]

    if (sortedTools.length > 0) {
      lines.push(`- Tools used: ${sortedTools.join(', ')}.`)
    }

    // 2. Key Technical Concepts
    lines.push('2. Key Technical Concepts:')
    const concepts = this.extractConcepts(messages)
    if (concepts.length > 0) {
      for (const c of concepts.slice(0, 6)) lines.push(`- ${c}`)
    } else {
      lines.push('- (see timeline below)')
    }

    // 3. Files and Code Sections
    lines.push('3. Files and Code Sections:')
    const keyFiles = this.extractKeyFiles(messages)
    if (keyFiles.length > 0) {
      for (const f of keyFiles.slice(0, 8)) lines.push(`- ${f}`)
    } else {
      lines.push('- (no source files referenced)')
    }

    // 6. All user messages (condensed)
    lines.push('6. All user messages:')
    const userMsgs = messages.filter(m => m.role === 'user' && m.content.trim())
    for (const m of userMsgs.slice(-8)) {
      lines.push(`- ${this.truncateSummary(m.content, 160)}`)
    }

    // 7. Pending Tasks
    const pendingWork = this.inferPendingWork(messages)
    if (pendingWork.length > 0) {
      lines.push('7. Pending Tasks:')
      for (const item of pendingWork) {
        lines.push(`- ${item}`)
      }
    }

    // 8. Current Work
    const currentWork = this.inferCurrentWork(messages)
    if (currentWork) {
      lines.push(`8. Current Work: ${currentWork}`)
    }

    // Key timeline (condensed)
    lines.push('- Key timeline:')
    for (const m of messages) {
      const content = this.truncateSummary(m.content, 80)
      const toolInfo = m.toolCalls?.map(tc => tc.function.name).join(', ')
      const display = toolInfo ? `${content} [tools: ${toolInfo}]` : content
      lines.push(`  - ${m.role}: ${display}`)
    }

    // Merge with existing summary
    if (existingSummary) {
      return this.mergeSummaries(existingSummary, lines.join('\n'))
    }

    return lines.join('\n')
  }

  private mergeSummaries(existingSummary: string, newSummary: string): string {
    const previousHighlights = this.extractHighlights(existingSummary)
    const newHighlights = this.extractHighlights(newSummary)
    const newTimeline = this.extractTimeline(newSummary)

    const lines: string[] = ['Conversation summary:']

    if (previousHighlights.length > 0) {
      lines.push('- Previously compacted context:')
      for (const h of previousHighlights) lines.push(`  ${h}`)
    }

    if (newHighlights.length > 0) {
      lines.push('- Newly compacted context:')
      for (const h of newHighlights) lines.push(`  ${h}`)
    }

    if (newTimeline.length > 0) {
      lines.push('- Key timeline:')
      for (const t of newTimeline) lines.push(`  ${t}`)
    }

    return lines.join('\n')
  }

  private extractHighlights(summary: string): string[] {
    const lines: string[] = []
    let inTimeline = false
    for (const line of summary.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed || trimmed === 'Conversation summary:' || trimmed === 'Summary:') continue
      if (trimmed === '- Key timeline:') { inTimeline = true; continue }
      if (inTimeline) continue
      lines.push(trimmed)
    }
    return lines
  }

  private extractTimeline(summary: string): string[] {
    const lines: string[] = []
    let inTimeline = false
    for (const line of summary.split('\n')) {
      const trimmed = line.trimEnd()
      if (trimmed === '- Key timeline:') { inTimeline = true; continue }
      if (!inTimeline) continue
      if (!trimmed) break
      lines.push(trimmed)
    }
    return lines
  }

  private inferPendingWork(messages: Session['messages']): string[] {
    const keywords = /todo|next|pending|follow.?up|remaining|待办|下一步|剩余/
    return messages
      .filter(m => m.role === 'assistant' && keywords.test(m.content.toLowerCase()))
      .slice(-3)
      .map(m => this.truncateSummary(m.content, 160))
      .reverse()
  }

  private extractKeyFiles(messages: Session['messages']): string[] {
    const interestingExts = /\.(ts|tsx|js|jsx|json|md|py|sql|yaml|yml|csv)$/i
    const files = new Set<string>()
    for (const m of messages) {
      const tokens = m.content.split(/\s+/)
      for (const token of tokens) {
        const cleaned = token.replace(/^[,.;:)"'`]+|[,.;:)"'`]+$/g, '')
        if (cleaned.includes('/') && interestingExts.test(cleaned)) {
          files.add(cleaned)
        }
      }
    }
    return Array.from(files).slice(0, 8)
  }

  private inferCurrentWork(messages: Session['messages']): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && m.content.trim()) {
        return this.truncateSummary(m.content, 200)
      }
    }
    return null
  }

  private extractConcepts(messages: Session['messages']): string[] {
    const conceptPatterns = [
      /\b(WebSocket|REST|API|HTTP|GraphQL|gRPC)\b/gi,
      /\b(TypeScript|JavaScript|React|Node\.js|Python|SQL|CSS|HTML)\b/gi,
      /\b(compaction|token|context|window|threshold|summariz|A2UI|MCP|LLM|session)\b/gi,
      /\b(database|schema|migration|index|query|transaction)\b/gi,
      /\b(auth|permission|role|session|token|OAuth|JWT)\b/gi,
      /\b(component|store|hook|state|render|effect)\b/gi,
    ]
    const concepts = new Set<string>()
    for (const m of messages) {
      for (const pattern of conceptPatterns) {
        const matches = m.content.match(pattern)
        if (matches) {
          for (const match of matches) {
            const capitalized = match.charAt(0).toUpperCase() + match.slice(1).toLowerCase()
            concepts.add(capitalized)
          }
        }
      }
    }
    return Array.from(concepts)
  }

  // ── Summary compression (from Claude Code summary_compression.rs) ──

  private compressSummary(summary: string): string {
    const { maxSummaryChars, maxSummaryLines, maxLineChars } = this.config

    const normalized = this.normalizeLines(summary, maxLineChars)
    if (normalized.lines.length === 0) return ''

    const selected = this.selectLines(normalized.lines, maxSummaryChars, maxSummaryLines)
    let omitted = normalized.lines.length - selected.length

    if (omitted > 0) {
      const notice = `... ${omitted} additional line(s) omitted.`
      if (selected.length < maxSummaryLines && this.joinedCharCount([...selected, notice]) <= maxSummaryChars) {
        selected.push(notice)
      }
    }

    return selected.join('\n')
  }

  private normalizeLines(text: string, maxLineChars: number): { lines: string[]; removedDuplicates: number } {
    const seen = new Set<string>()
    const lines: string[] = []
    let removedDuplicates = 0

    for (const rawLine of text.split('\n')) {
      const collapsed = rawLine.split(/\s+/).join(' ').trim()
      if (!collapsed) continue
      const truncated = collapsed.length > maxLineChars
        ? collapsed.slice(0, maxLineChars - 1) + '…'
        : collapsed
      const dedupeKey = truncated.toLowerCase()
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        lines.push(truncated)
      } else {
        removedDuplicates++
      }
    }

    return { lines, removedDuplicates }
  }

  private selectLines(lines: string[], maxChars: number, maxLines: number): string[] {
    const prioritized = lines.map((line, idx) => ({ line, idx, priority: this.linePriority(line) }))
    const selected = new Map<number, string>()

    for (let priority = 0; priority <= 3; priority++) {
      for (const item of prioritized) {
        if (item.priority !== priority || selected.has(item.idx)) continue
        const candidate = Array.from(selected.values()).concat(item.line)
        if (candidate.length > maxLines) continue
        if (this.joinedCharCount(candidate) > maxChars) continue
        selected.set(item.idx, item.line)
      }
    }

    return Array.from(selected.entries())
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line)
  }

  private linePriority(line: string): number {
    const corePatterns = [
      '- Scope:', '- Current work:', '- Pending work:', '- Key files:',
      '- Tools mentioned:', '- Recent user requests:', '- Previously compacted:',
      '- Newly compacted:', 'Conversation summary:', 'Summary:',
    ]
    if (corePatterns.some(p => line.startsWith(p))) return 0
    if (line.trimEnd().endsWith(':')) return 1
    if (/^\s*[-*]/.test(line)) return 2
    return 3
  }

  private joinedCharCount(lines: string[]): number {
    return lines.reduce((sum, l) => sum + l.length, 0) + Math.max(0, lines.length - 1)
  }

  // ── Cleanup / Eviction ──

  startCleanup(): void {
    const cron = require('node-cron')
    const minute = Math.floor(Math.random() * 5) + 1
    const expression = `${minute} */${CLEANUP_INTERVAL_MINUTES} * * *`
    console.log(`[SessionStore] Cleanup job scheduled: ${expression}`)

    this.cleanupJob = cron.schedule(expression, () => {
      this.runCleanup()
    })
  }

  stopCleanup(): void {
    if (this.cleanupJob) {
      this.cleanupJob.stop()
      this.cleanupJob = null
    }
  }

  runCleanup(): { evictedByTtl: number; evictedByMaxCount: number; remaining: number } {
    let evictedByTtl = 0
    let evictedByMaxCount = 0

    // TTL eviction
    const ttlResult = this.db.prepare(`
      DELETE FROM agent_sessions
      WHERE updated_at < datetime('now', 'localtime', '-${SESSION_TTL_HOURS} hours')
    `).run()
    evictedByTtl = ttlResult.changes

    // Cascade delete orphaned messages and compactions
    this.db.prepare(`
      DELETE FROM agent_messages WHERE session_key NOT IN (SELECT id FROM agent_sessions)
    `).run()
    this.db.prepare(`
      DELETE FROM agent_compactions WHERE session_key NOT IN (SELECT id FROM agent_sessions)
    `).run()

    // Max session count eviction
    const countRow = this.db.prepare('SELECT COUNT(*) as c FROM agent_sessions').get() as any
    const total = countRow?.c || 0
    if (total > MAX_SESSIONS) {
      const excess = total - MAX_SESSIONS
      const evictResult = this.db.prepare(`
        DELETE FROM agent_sessions WHERE id IN (
          SELECT id FROM agent_sessions ORDER BY updated_at ASC LIMIT ?
        )
      `).run(excess)
      evictedByMaxCount = evictResult.changes

      this.db.prepare(`
        DELETE FROM agent_messages WHERE session_key NOT IN (SELECT id FROM agent_sessions)
      `).run()
      this.db.prepare(`
        DELETE FROM agent_compactions WHERE session_key NOT IN (SELECT id FROM agent_sessions)
      `).run()
    }

    // Sync in-memory map
    if (this.sessionsRef) {
      const dbKeys = new Set(
        (this.db.prepare('SELECT id FROM agent_sessions').all() as any[]).map(r => r.id)
      )
      for (const key of this.sessionsRef.keys()) {
        if (!dbKeys.has(key)) {
          this.sessionsRef.delete(key)
        }
      }
    }

    const remaining = (this.db.prepare('SELECT COUNT(*) as c FROM agent_sessions').get() as any)?.c || 0
    console.log(`[SessionStore] Cleanup: evicted ${evictedByTtl} by TTL, ${evictedByMaxCount} by max count, ${remaining} remaining`)

    return { evictedByTtl, evictedByMaxCount, remaining }
  }

  // ── Helpers ──

  private syncMessagesToDb(key: string, messages: Session['messages']): void {
    const insert = this.db.prepare(`
      INSERT INTO agent_messages (session_key, role, content, reasoning_content, tool_call_id, tool_calls_json, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      insert.run(
        key,
        m.role,
        this.truncateField(m.content),
        m.reasoningContent || '',
        m.toolCallId || '',
        m.toolCalls ? JSON.stringify(m.toolCalls) : '',
        i,
      )
    }
  }

  private truncateField(text: string, maxChars: number = 16384): string {
    if (text.length <= maxChars) return text
    return text.slice(0, maxChars) + '... [truncated for session storage]'
  }

  private truncateSummary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text
    return text.slice(0, maxChars - 1) + '…'
  }

  close(): void {
    this.stopCleanup()
    this.db.close()
  }
}

const COMPACT_PREAMBLE = `[The conversation up to this point has been summarized to preserve context. The summary below captures all completed work, key decisions, errors/fixes, and pending tasks. Read it before continuing — it provides the full background needed to resume work seamlessly.]

`

const COMPACT_RECENT_NOTE = `[The ${DEFAULT_COMPACTION_CONFIG.preserveRecentMessages} most recent messages above this line are preserved verbatim. The summary below covers all earlier messages.]`

// Token estimation helper
export function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  const otherChars = text.length - cjkChars
  return Math.ceil(cjkChars * 1.5 + otherChars * 0.25)
}
