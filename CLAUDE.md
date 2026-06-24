# 订单履约控制塔 — AI 助手指南

## 项目启动

项目由三个服务组成，需要全部启动：

```bash
# 终端 1 — 后端 API 服务（端口 3001）
cd backend && npm run dev

# 终端 2 — Agent 服务（端口 3002，WebSocket + Skills/Models API）
cd agent-service && npm run dev

# 终端 3 — 前端开发服务器（端口 5173）
cd frontend && npm run dev
```

### 快速启动（一键三个服务）

```bash
cd backend && npm run dev &
cd agent-service && npm run dev &
cd frontend && npm run dev &
```

启动后访问 **http://localhost:5173/** 即可打开应用。

### 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| backend | 3001 | Express API + WebSocket `/ws/chat` |
| agent-service | 3002 | Agent 引擎 + WebSocket `/ws/agent` + Skills/Models API |
| frontend | 5173 | Vite + React 开发服务器 |

### 前置条件

- Node.js >= 18
- 三个服务目录下均已执行 `npm install`

## 技术栈

- **前端**: React 19 + TypeScript + Vite + Tailwind CSS 4 + Zustand
- **后端**: Express 5 + TypeScript + better-sqlite3 + WebSocket (ws)
- **Agent**: Express 5 + LLM 引擎 (DeepSeek/豆包) + MCP Pool + Cron 调度

## 关键配置文件

- `agent-service/.claw/llm.config.json` — LLM 提供商和模型配置
- `agent-service/.claw/.env` — Agent 服务环境变量
- `backend/.env` — 后端环境变量
- `frontend/vite.config.ts` — Vite 配置
