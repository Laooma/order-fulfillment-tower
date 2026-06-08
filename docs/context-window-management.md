# 订单履约控制塔 — 上下文窗口管理机制

> 本文档记录本项目的上下文窗口管理完整方案，涵盖 token 追踪、自动压缩、计划模式、缓存策略等核心机制。设计参考 Claude Code 的上下文管理架构，适配 DeepSeek / 火山引擎等多 LLM 提供方。

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    每次 API 请求 = 完整上下文               │
│  ┌──────────────┬──────────────────┬──────────────────┐ │
│  │ System Prompt │ Project Context  │  Conversation    │ │
│  │  (静态)       │  (会话级静态)     │  (每轮动态)       │ │
│  └──────────────┴──────────────────┴──────────────────┘ │
│         ↑ 缓存前缀匹配：前面不变则命中缓存，仅处理新增部分    │
└─────────────────────────────────────────────────────────┘
```

**核心设计原则**：

| 原则 | 说明 |
|------|------|
| **Everything is prefix matching** | 每次 API 请求发送完整上下文，缓存基于精确前缀匹配 |
| **Static first, dynamic last** | 系统提示词 → 项目上下文 → 对话历史，按稳定性排序 |
| **Messages over prompt mutation** | 通过追加消息注入状态变化，不修改系统提示词或工具列表 |
| **Never change tools mid-session** | 工具列表变化 = 缓存前缀破坏，用指令约束替代工具过滤 |
| **Fork must share parent prefix** | 压缩/计划等分支操作复用父会话前缀，实现缓存安全的 fork |

---

## 2. Token 追踪机制

### 2.1 追踪模型

```
每个 LLM API 调用返回 usage.prompt_tokens
         │
         ▼
┌──────────────────────────────────────────┐
│  iterationPromptTokens  (本轮实际输入大小) │──→ 前端显示 + 压缩判断
│  totalTokens.prompt      (全流程累加)     │──→ 成本统计
│  cumulativeInputTokens   (DB 持久化)      │──→ 跨请求累计
└──────────────────────────────────────────┘
```

### 2.2 关键修正：避免 token 双重计数

**问题**：早期版本将每次 API 调用的 `prompt_tokens` 累加到 `cumulativeInputTokens`，但每次调用都包含完整历史——导致早期消息被重复计数 N 次，上下文百分比显示超过 100%。

**修正**（`agentLoop.ts:trackTokensAndCompact`）：
- 上下文占用百分比 = **最近一次 API 调用的 `prompt_tokens`** / `contextWindow`
- `cumulativeInputTokens` 仅用于成本分析，不参与压缩决策
- `complete` 消息使用 `lastContextTokens`（末轮实际值），非累加总值

### 2.3 各模型上下文窗口配置

配置位于 `agent-service/llm.config.json`：

| 模型 | Context Window | 压缩阈值 (80%) | 警告阈值 (70%) |
|------|:------------:|:------------:|:------------:|
| `deepseek-chat` (默认) | 128K | 102,400 | 89,600 |
| `deepseek-reasoner` (R1) | 128K | 102,400 | 89,600 |
| `deepseek-v4-flash` | 256K | 204,800 | 179,200 |
| `deepseek-v4-pro` | 1,000K | 800,000 | 700,000 |
| `doubao-seed-2.0-pro` | 256K | 204,800 | 179,200 |

---

## 3. 自动压缩（Compaction）

### 3.1 Cache-Safe Fork 架构

参考 Claude Code 的设计，压缩采用**缓存安全的分支**模式：

```
                     主会话请求
              ┌─────────────────────┐
              │ [System Prompt]      │ ← 缓存前缀（不变）
              │ [Tool Definitions]   │
              │ [Conversation 1..N]  │
              │ [Latest User Msg]    │ ← 仅此部分需处理
              └─────────────────────┘
                      │
                      │  promptTokens >= 80% contextWindow
                      ▼
              ┌─────────────────────────────────────┐
              │ 压缩请求（复用主会话前缀）              │
              │ [System Prompt]        ← 缓存命中！  │
              │ [Tool Definitions]     ← 缓存命中！  │
              │ [Conversation 1..N]    ← 缓存命中！  │
              │ + "Summarize the above..." ← 仅新增  │
              └─────────────────────────────────────┘
                      │
                      ▼
              ┌─────────────────────┐
              │ [System Prompt]      │
              │ [Summary Message]    │ ← 压缩后的精简历史
              │ [Recent 4 Messages]  │
              │ [Breadcrumb]         │ ← 压缩元信息
              └─────────────────────┘
```

### 3.2 两段式阈值

```
上下文占用
 100% ┤
  80% ┤ ████████████ 触发压缩 (compactThreshold)
      ┤              ↓ cache-safe fork → LLM 总结 → 替换历史
  70% ┤ ░░░░░░░░░░░░ 触发警告 (warnThreshold)
      ┤              → 前端显示橙色警告
   0% ┤
```

- **70% (warnThreshold)**：前端上下文指示器变橙色，提示用户即将压缩
- **80% (compactThreshold)**：触发自动压缩

### 3.3 压缩流程

```
trackTokensAndCompact()
  │
  ├─ addInputTokens()         → 写入 DB 成本统计
  ├─ 判断 promptTokens >= 70% → 发送 context_warning（前端警告）
  ├─ 判断 promptTokens >= 80% → 触发压缩
  │   │
  │   ├─ compactSession()     → 生成 LLM 摘要（cache-safe fork）
  │   │   ├─ 保留最近 4 条消息（保护 tool_use/tool_result 配对）
  │   │   ├─ 其余消息 → LLM 总结为结构化摘要
  │   │   └─ cumulative_input_tokens 重置为 0
  │   │
  │   ├─ getSession()         → 刷新内存中的消息列表
  │   └─ 注入 Breadcrumb      → "[Compaction: N messages summarized...]"
  │
  └─ 失败兜底 → resetInputTokens() → 避免计数器永久损坏
```

### 3.4 压缩配置参数

`agent-service/src/services/sessionStore.ts`：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `preserveRecentMessages` | 4 | 保留最近 N 条消息不压缩 |
| `maxEstimatedTokens` | 10,000 | 压缩摘要预估 token 上限 |
| `triggerTokenThreshold` | 100,000 | 硬阈值（动态 80% 优先生效） |
| `maxSummaryChars` | 2,000 | 摘要最大字符数 |
| `maxSummaryLines` | 40 | 摘要最大行数 |
| `SESSION_TTL_HOURS` | 24 | 闲置会话自动清理 |
| `MAX_SESSIONS` | 1,000 | 最大会话存储数 |

### 3.5 摘要格式

```markdown
[The conversation up to this point has been summarized to preserve context...]

1. Primary Request and Intent: ...
2. Key Technical Concepts: ...
3. Files and Code Sections: ...
4. Errors and fixes: ...
5. Problem Solving: ...
6. All user messages: ...
7. Pending Tasks: ...
8. Current Work: ...
9. Optional Next Step: ...

[The 4 most recent messages above this line are preserved verbatim.]
```

### 3.6 压缩后上下文注入

压缩完成后自动追加一条 system message（breadcrumb）：

```
[Compaction: 12 earlier messages were summarized above. 
Current date: 2026-06-08. The summary preserves key decisions, 
file changes, errors, and pending tasks.]
```

---

## 4. 计划模式（Plan Mode）

### 4.1 设计理念

参考 Claude Code 的 `EnterPlanMode` / `ExitPlanMode` 工具模式：
- **不改变工具列表**（破坏缓存前缀）
- **通过指令约束**限制 Agent 行为
- 进入/退出都是追加消息，保持前缀稳定

### 4.2 工作流程

```
用户请求 → Agent 判断需要规划
     │
     ▼
enter_plan_mode(goal="优化首页筛选功能")
     │
     ├─ 前端：📋 计划中… 脉冲指示器
     ├─ 后端：planModeSessions.add(sessionId)
     ├─ 注入：[PLAN MODE ACTIVE — READ-ONLY RESEARCH PHASE] 指令
     └─ MAX_ITERATIONS: 8 → 20（研究阶段需要更多轮次）
     │
     ▼
Agent 研究阶段（只读约束）
  · todo_write 创建研究任务
  · fetch_orders / fetch_biz_data / search_material_stock 查询数据
  · 文件搜索、代码读取（MCP 工具）
     │
     ▼
Agent 研究充分 → save_plan(title, content)
     │
     ├─ 保存：agent-service/plans/{YYYYMMDD}-{slug}.md
     ├─ YAML frontmatter: title, created, sessionId, status:pending
     ├─ 前端：计划卡片渲染（Markdown）+ ⏳ 待审批
     └─ 退出计划模式，恢复 MAX_ITERATIONS=8
```

### 4.3 计划文档格式

```markdown
---
title: "异常订单处理流程优化计划"
created: 2026-06-08T02:52:54.161Z
sessionId: 3d98d9a2-f185-4c0c-b1b9-38c0388b149e
status: pending
---

# 计划标题

## Context（当前状态和背景）
数据现状、分布特征、当前流程问题

## 改动（逐项详细描述）
### 改动 1：改动项 — `文件路径`
**当前**：现有行为
**改为**：目标行为
**实现**：实现方式

## 涉及文件
| 文件 | 操作 | 说明 |
|------|------|------|

## 验证（验收步骤清单）
1. ✅ 验证项
```

---

## 5. 前端展示

### 5.1 上下文指示器

位于 AI 助手面板标题栏右侧：

| 占比 | 颜色 | 状态 |
|------|------|------|
| 0–70% | 🟢 绿色 | 正常 |
| 70–80% | 🟡 橙色 | 警告（即将压缩） |
| 80–95% | 🟡 橙色 | 即将触发压缩 |
| >95% | 🔴 红色 | 危险 |
| 压缩中 | 🔵 蓝色条纹动画 | "压缩中…" |

### 5.2 计划模式指示器

- 📋 脉冲动画 + "计划中…"
- 计划完成后自动消失

### 5.3 计划结果卡片

- 在对话区顶部展示完整计划文档
- Markdown 渲染（表格、代码块、标题层级）
- ⏳ 待审批 徽章

---

## 6. 性能优化策略

### 6.1 当前已实施

| 策略 | 效果 |
|------|------|
| Cache-safe fork compaction | 压缩调用复用主会话缓存前缀 |
| 指令约束替代工具过滤 | 计划模式不破坏缓存 |
| 每轮独立 prompt_tokens | 上下文百分比准确，不超 100% |
| 两段式压缩阈值 | 70% 提前预警，80% 触发 |
| Breadcrumb 注入 | 压缩后 Agent 知晓状态，减少重读 |
| MAX_ITERATIONS 动态调整 | 计划模式 20 轮 vs 普通模式 8 轮 |
| 消息内容 DB 截断 | 单条 >16,384 字符自动截断 |

### 6.2 未来可优化

| 策略 | 说明 | 优先级 |
|------|------|--------|
| MCP tool defer_loading | 工具 schema 延迟加载，减少系统提示词固定开销 | 中 |
| 1M 上下文模型 | 切换默认模型为 `deepseek-v4-pro` | 高 |
| 手动 `/compact` 命令 | 用户主动触发压缩（含自定义保留指令） | 中 |
| Prompt caching 显式管理 | `cache_control` breakpoints 标记 | 低 |
| Sub-agent 隔离上下文 | 大任务拆分为独立 agent，结果回传 | 低 |
| 会话分支 | 上下文满时自动分叉新会话 + 交接文档 | 低 |

---

## 7. 关键代码路径

```
agent-service/
├── llm.config.json                  # 模型配置（contextWindow、apiKey）
├── plans/                           # 计划文档输出目录
└── src/
    ├── types/index.ts               # 类型定义（AgentMessage、Session）
    └── services/
        ├── agentLoop.ts             # 核心循环
        │   ├── trackTokensAndCompact()    # token 追踪 + 压缩触发
        │   ├── handleEnterPlanMode()      # 进入计划模式
        │   ├── handleSavePlan()           # 保存计划文档
        │   ├── isPlanMode()               # 计划模式状态查询
        │   └── MAX_ITERATIONS / MAX_ITERATIONS_PLAN_MODE
        ├── sessionStore.ts          # 会话持久化
        │   ├── compactSession()           # 压缩执行
        │   ├── addInputTokens()           # token 累计
        │   ├── getCumulativeInputTokens() # token 查询
        │   └── resetInputTokens()         # token 重置
        ├── llmConfig.ts             # LLM 配置加载
        ├── llmEngine.ts             # LLM API 调用封装
        └── toolManager.ts           # 工具启用/禁用管理

frontend/src/
├── components/
│   └── ChatPanel.tsx                # 上下文指示器 + 计划模式 UI
├── hooks/
│   └── useWebSocket.ts             # WebSocket 消息类型
└── index.css                        # 上下文/计划模式样式
```

---

## 8. 会话生命周期

```
创建会话
  │
  ├─ getOrCreateSession()  → 设置 system prompt
  ├─ todoStores 初始化
  ├─ exitPlanMode()  ← 清理上次计划模式状态
  │
  ▼
while (iteration < MAX_ITERATIONS)
  │
  ├─ LLM 调用 → iterationPromptTokens
  ├─ context_update  → 前端显示百分比
  ├─ trackTokensAndCompact()
  │   ├─ 70% → context_warning
  │   └─ 80% → compaction (cache-safe fork)
  └─ 工具调用处理
  │
  ▼
complete 消息 → lastContextTokens（末轮实际值）
  │
  ▼
会话持久化 → SQLite (agent-sessions.db)
  │
  ├─ SESSION_TTL_HOURS (24h)  → 自动清理
  └─ clearSession()  → 清理内存 + plan mode
```
