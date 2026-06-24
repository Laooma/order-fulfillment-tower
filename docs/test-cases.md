# 订单履约控制塔 — 测试用例文档

> 版本: v1.0  
> 更新日期: 2026-06-16  
> 覆盖范围: 前端 (React 19)、后端 API (Express 5 + better-sqlite3)、Agent 服务 (Express 5 + LLM)、WebSocket、安全、性能

---

## 1. 测试概述

| 项目 | 说明 |
|------|------|
| **测试目标** | 验证订单履约控制塔系统的功能正确性、接口稳定性、数据安全性及性能表现 |
| **测试策略** | 单元测试 + 接口测试 + 集成测试 + E2E 场景测试 + 安全测试 + 性能测试 |
| **自动化建议** | 前端使用 Vitest + React Testing Library；后端使用 Vitest/Supertest；E2E 使用 Playwright |
| **测试环境** | `backend:3001` / `agent-service:3002` / `frontend:5173` |

---

## 2. 测试环境配置

```bash
# 前置条件
Node.js >= 18
三个服务目录均已 npm install

# 启动全部服务
cd backend && npm run dev &
cd agent-service && npm run dev &
cd frontend && npm run dev &

# 可选：初始化 Symlink（首次部署）
cd agent-service/.claw
ln -s ../../.claw/skills skills
ln -s ../../.claw/cron-tasks cron-tasks
```

---

## 3. 前端功能测试用例

### 3.1 登录认证模块

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-AUTH-001 | 正常登录 | 服务已启动 | 1. 访问 `http://localhost:5173`<br>2. 输入有效用户名密码<br>3. 点击登录 | 登录成功，跳转首页，localStorage 写入 `auth_token` | P0 |
| FE-AUTH-002 | 空字段校验 | 在登录页 | 1. 留空用户名/密码<br>2. 点击登录 | 提示"请输入用户名和密码"，不发起请求 | P0 |
| FE-AUTH-003 | 错误密码 | 用户存在 | 1. 输入正确用户名 + 错误密码<br>2. 点击登录 | 提示"Invalid username or password" | P0 |
| FE-AUTH-004 | 禁用账号登录 | 账号 enabled=0 | 使用禁用账号登录 | 提示"Account is disabled" | P1 |
| FE-AUTH-005 | Token 过期处理 | 已登录但 token 过期 | 1. 等待 token 过期（或手动清除）<br>2. 刷新页面 | 自动跳转登录页，redirect 参数保留当前路径 | P1 |
| FE-AUTH-006 | 登出功能 | 已登录 | 点击右上角用户菜单 → 退出 | 清除 token，跳转登录页 | P1 |

### 3.2 首页 — 销售订单

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-ORD-001 | 订单列表加载 | 已登录 | 进入首页 | 默认展示销售订单 Tab，加载 20 条数据，分页显示 1/3 | P0 |
| FE-ORD-002 | 分页切换 | 订单列表已加载 | 点击分页第 2 页 | 加载第 2 页数据，URL 参数无变化 | P0 |
| FE-ORD-003 | 页大小切换 | 订单列表已加载 | 切换 pageSize 为 50 | 重新加载并展示最多 50 条 | P1 |
| FE-ORD-004 | 按销售员筛选 | 订单列表已加载 | 输入销售员"李明" → 搜索 | 列表只显示李明的订单，total 减少 | P0 |
| FE-ORD-005 | 按签收状态筛选 | 订单列表已加载 | 签收状态选"未签收" | 只显示 receiptRatio < 30% 的订单 | P0 |
| FE-ORD-006 | 按出库状态筛选 | 订单列表已加载 | 出库状态选"已出库" | 只显示 shipmentRatio >= 100% 的订单 | P0 |
| FE-ORD-007 | 按是否异常筛选 | 订单列表已加载 | 是否异常选"异常" | 只显示 isException=true 的订单 | P0 |
| FE-ORD-008 | 多条件组合筛选 | 订单列表已加载 | 同时设置品牌+销售员+签收状态 | 列表符合所有条件交集 | P0 |
| FE-ORD-009 | 重置筛选 | 已应用筛选条件 | 点击"重置"按钮 | 所有筛选条件清空，列表恢复初始状态 | P1 |
| FE-ORD-010 | 单选/多选订单 | 订单列表已加载 | 点击行首 checkbox | 选中状态正确，批量操作按钮可用 | P1 |
| FE-ORD-011 | 全选当前页 | 订单列表已加载 | 点击表头 checkbox | 当前页所有行选中 | P1 |
| FE-ORD-012 | "加入对话"按钮 | 已选中订单 | 点击某行"加入对话" | 右侧 AI 助手面板收到该订单上下文 | P0 |
| FE-ORD-013 | 批量加入对话 | 已多选订单 | 点击"批量添加至对话" | AI 助手面板收到多条订单上下文 | P1 |
| FE-ORD-014 | 订单详情跳转 | 订单列表已加载 | 点击订单编号链接 | 跳转订单详情页（如有）或展开详情 | P2 |

### 3.3 首页 — 机柜包

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-CAB-001 | Tab 切换 | 在首页 | 点击"机柜包"Tab | 加载机柜包列表数据 | P1 |
| FE-CAB-002 | 机柜包筛选 | 在机柜包 Tab | 按状态/工厂/发货状态/客户筛选 | 列表结果符合筛选条件 | P1 |

### 3.4 AI 专属助手面板

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-AI-001 | Skill 下拉加载 | 已登录 | 打开右侧 AI 面板 | Skill 下拉框加载全部可用 Skill（20+） | P0 |
| FE-AI-002 | 选择 Skill | AI 面板已打开 | 点击 Skill 下拉，选择"分析助手" | 输入框上方显示已选 Skill，发送消息时携带 skillId | P0 |
| FE-AI-003 | 发送消息 | 已选择 Skill | 输入消息 → 点击发送 | 消息出现在对话列表，等待 AI 回复 | P0 |
| FE-AI-004 | WebSocket 流式接收 | 已发送消息 | 等待 AI 回复 | 逐字/逐段显示回复内容（streaming） | P0 |
| FE-AI-005 | 引用订单上下文 | 已将订单加入对话 | 发送"分析这个订单" | AI 回复中包含订单相关数据 | P0 |
| FE-AI-006 | 新建对话 | 已有对话历史 | 点击"新建对话" | 清空当前对话，开启新 session | P1 |
| FE-AI-007 | 历史对话 | 有历史 session | 点击"历史对话" | 展示历史 session 列表，可切换 | P1 |
| FE-AI-008 | 切换模型 | AI 面板已打开 | 点击模型选择器（deepseek-chat） | 可切换不同模型 | P1 |
| FE-AI-009 | 宠物切换 | 已领养宠物 | 点击宠物头像 | 弹出宠物选择弹窗，可更换 | P2 |
| FE-AI-010 | 面板收起/展开 | AI 面板已打开 | 点击收起按钮 | 面板折叠为图标，再次点击展开 | P1 |

### 3.5 分析任务模块

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-ANA-001 | 分析任务列表 | 已登录 | 点击左侧"分析任务列表" | 加载分析任务，展示 title/status/createdAt 等 | P0 |
| FE-ANA-002 | 任务搜索 | 在分析任务页 | 按 taskId 搜索 | 结果匹配输入内容 | P1 |
| FE-ANA-003 | 状态筛选 | 在分析任务页 | 按 status 筛选 | 只显示对应状态的任务 | P1 |
| FE-ANA-004 | 查看任务详情 | 在分析任务页 | 点击某任务 | 跳转 `/analysis/:id`，展示完整看板 | P0 |
| FE-ANA-005 | 看板卡片详情 | 在任务详情页 | 点击问题卡片 | 展示卡片详细信息和处理建议 | P0 |
| FE-ANA-006 | 生成待办 | 任务状态为 analyzed | 点击"生成待办" | 调用 API 生成 todos，状态变为 todos_generated | P0 |
| FE-ANA-007 | A2UI 可视化渲染 | 任务包含 a2uiMessages | 在任务详情页 | A2UI 看板正确渲染图表/仪表盘 | P0 |

### 3.6 执行任务模块

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-TASK-001 | 执行任务列表 | 已登录 | 点击"执行任务列表" | 加载待办任务，按优先级排序 | P0 |
| FE-TASK-002 | 任务筛选 | 在任务列表页 | 按类型/状态/分类/负责人/优先级筛选 | 结果正确过滤 | P1 |
| FE-TASK-003 | 搜索任务 | 在任务列表页 | 输入关键词搜索 | 按 description/contractId/assignee 模糊匹配 | P1 |
| FE-TASK-004 | 标记完成 | 有未完成任务 | 点击"标记完成" | 状态变为 done，刷新列表 | P0 |
| FE-TASK-005 | 完成任务验证 | 点击标记完成 | 后端验证库存缺口 | 如仍有缺口，提示失败原因 | P0 |
| FE-TASK-006 | 数据权限隔离 | 普通用户登录 | 查看任务列表 | 只能看到符合自己数据权限范围的任务 | P0 |

### 3.7 Token 消耗统计

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-TOK-001 | 打开统计面板 | 已登录 | 点击顶栏"📊"按钮 | 弹出 Token 消耗统计弹窗 | P1 |
| FE-TOK-002 | 汇总数据展示 | 统计面板已打开 | 查看总消耗/输入/输出 token | 数据与后端 `/usage/summary` 一致 | P1 |
| FE-TOK-003 | 每日趋势图 | 统计面板已打开 | 查看每日趋势 | 展示最近 14 天每日消耗折线图 | P1 |
| FE-TOK-004 | 模型分布 | 统计面板已打开 | 查看模型分布 | 各模型消耗占比正确 | P1 |

### 3.8 系统设置页

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-SET-001 | 菜单权限控制 | 普通用户登录 | 进入系统设置 | 只显示有权限的菜单项（如看不到 Skill 管理） | P0 |
| FE-SET-002 | LLM 配置加载 | 管理员登录 | 点击"大模型接入点" | 正确展示 providers 和 models | P1 |
| FE-SET-003 | 添加供应商 | 在 LLM 配置页 | 填写名称/API URL/Key → 添加 | 新供应商出现在列表 | P1 |
| FE-SET-004 | Skill 管理 CRUD | 管理员登录 | 在 Skill 管理页新建/编辑/删除 Skill | 操作成功，列表实时刷新 | P1 |
| FE-SET-005 | Hook 管理 | 管理员登录 | 新建 Hook，设置触发事件和脚本 | 保存成功 | P1 |
| FE-SET-006 | MCP 管理 | 管理员登录 | 新建 MCP 服务器配置 | 保存成功 | P1 |
| FE-SET-007 | 插件管理 | 管理员登录 | 新建/启用/禁用插件 | 状态切换生效 | P1 |
| FE-SET-008 | 定时任务管理 | 管理员登录 | 在定时任务页查看任务列表 | 展示所有 cron-tasks，可启用/禁用/手动执行 | P1 |
| FE-SET-009 | 通知渠道管理 | 管理员登录 | 新建/编辑/删除通知渠道 | 操作成功，支持邮件/飞书/钉钉/企微 | P1 |
| FE-SET-010 | 通知模板管理 | 管理员登录 | 查看/编辑通知模板 | 模板列表正确，变量替换正常 | P1 |
| FE-SET-011 | 发送测试消息 | 有通知渠道 | 点击测试按钮 | 收到测试消息，日志记录成功 | P1 |
| FE-SET-012 | Subagent 管理 | 管理员登录 | 新建/编辑/删除 Subagent | CRUD 正常 | P1 |
| FE-SET-013 | 组织机构管理 | 管理员登录 | 增删改查组织节点 | 树形结构正确更新 | P1 |
| FE-SET-014 | 用户管理 | 管理员登录 | 增删改查用户，分配角色 | 用户权限实时生效 | P1 |
| FE-SET-015 | 角色与权限 | 管理员登录 | 配置角色的菜单/操作/数据权限 | 权限正确绑定，用户端生效 | P0 |
| FE-SET-016 | Skill 权限分配 | 管理员登录 | 给角色分配可用 Skill | 用户只能看到被授权的 Skill | P0 |

### 3.9 暗色模式

| 编号 | 功能点 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| FE-THE-001 | 切换暗色模式 | 在任意页 | 点击顶栏"切换暗色模式" | 全局主题切换为暗色，刷新后保持 | P2 |

---

## 4. 后端 API 测试用例

### 4.1 认证模块 (`/api/auth/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-AUTH-001 | 正常登录 | POST /login | body: `{username, password}` | 返回 `{token, user}`，token 为有效 JWT | P0 |
| BE-AUTH-002 | 缺少字段 | POST /login | body: `{}` | 400, `error: username and password are required` | P0 |
| BE-AUTH-003 | 用户名不存在 | POST /login | body: `{username: "notexist", password}` | 401, `error: Invalid username or password` | P0 |
| BE-AUTH-004 | 密码错误 | POST /login | body: `{username: "admin", password: "wrong"}` | 401, `error: Invalid username or password` | P0 |
| BE-AUTH-005 | 禁用账号 | POST /login | 使用 enabled=0 的账号 | 401, `error: Account is disabled` | P1 |
| BE-AUTH-006 | 获取当前用户 | GET /me | Header: `Authorization: Bearer <token>` | 返回当前用户完整信息（含 permissions） | P0 |
| BE-AUTH-007 | 无 Token 访问 | GET /me | 无 Authorization header | 返回匿名用户信息（X-User-Id fallback） | P1 |
| BE-AUTH-008 | Token 过期 | GET /me | 使用过期 JWT | 匿名用户 fallback | P1 |
| BE-AUTH-009 | 登出 | POST /logout | 任意请求 | 返回 `{success: true}` | P1 |
| BE-AUTH-010 | 更新宠物 | PUT /pet | body: `{adoptedPetId}` | 更新成功，DB 记录变更 | P2 |

### 4.2 订单模块 (`/api/orders/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-ORD-001 | 列表无筛选 | GET /orders | 无参数 | 返回全部 60 条订单，分页 1/12 | P0 |
| BE-ORD-002 | 分页参数 | GET /orders?page=2&pageSize=10 | 分页请求 | 返回第 2 页 10 条数据 | P0 |
| BE-ORD-003 | 按客户筛选 | GET /orders?customer=广东重工 | customer 模糊匹配 | 只返回匹配的订单 | P0 |
| BE-ORD-004 | 按签收状态-未签收 | GET /orders?receiptStatus=未签收 | receiptStatus 参数 | receiptRatio < 30% | P0 |
| BE-ORD-005 | 按签收状态-部分签收 | GET /orders?receiptStatus=部分签收 | receiptStatus 参数 | 30% <= receiptRatio < 100% | P0 |
| BE-ORD-006 | 按签收状态-全部签收 | GET /orders?receiptStatus=全部签收 | receiptStatus 参数 | receiptRatio >= 100% | P0 |
| BE-ORD-007 | 按出库状态-待出库 | GET /orders?deliveryStatus=待出库 | deliveryStatus 参数 | shipmentRatio === 0 | P0 |
| BE-ORD-008 | 按出库状态-已出库 | GET /orders?deliveryStatus=已出库 | deliveryStatus 参数 | shipmentRatio >= 100% | P0 |
| BE-ORD-009 | 按出库状态-部分出库 | GET /orders?deliveryStatus=部分出库 | deliveryStatus 参数 | 0 < shipmentRatio < 100% | P0 |
| BE-ORD-010 | 按异常筛选 | GET /orders?isException=true | isException 参数 | 只返回 isException=true | P0 |
| BE-ORD-011 | 组合筛选 | GET /orders?customer=xxx&salesperson=xxx&receiptStatus=未签收 | 多参数 | 返回符合所有条件的交集 | P0 |
| BE-ORD-012 | 单条详情 | GET /orders/:id | 有效 id | 返回订单完整 JSON | P0 |
| BE-ORD-013 | 详情不存在 | GET /orders/notexist | 无效 id | 404, `error: Order not found` | P0 |
| BE-ORD-014 | 越界页码 | GET /orders?page=999 | 超大页码 | 返回空数组，total 正确 | P1 |

### 4.3 业务合同模块 (`/api/biz-contracts/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-BIZ-001 | 合同列表 | GET /biz-contracts | 无参数 | 返回合同列表，分页正确 | P1 |
| BE-BIZ-002 | 合同详情 | GET /biz-contracts/:id | 有效 id | 返回合同详情 | P1 |
| BE-BIZ-003 | 合同设备列表 | GET /biz-contracts/:id/devices | 有效 id | 返回设备列表 | P1 |
| BE-BIZ-004 | 合同包列表 | GET /biz-contracts/:id/packages | 有效 id | 返回包列表 | P1 |
| BE-BIZ-005 | 齐套检查 | GET /biz-contracts/:id/kit-check | 有效 id | 返回物料齐套分析结果 | P0 |
| BE-BIZ-006 | 包齐套检查 | GET /biz-contracts/packages/:id/kit-check | 有效包 id | 返回包级齐套分析 | P0 |
| BE-BIZ-007 | 物料详情 | GET /biz-contracts/materials/:id | 有效 id | 返回物料详情及日平衡 | P1 |
| BE-BIZ-008 | 物料搜索 | GET /biz-contracts/materials/search?code=xxx | 物料编码 | 返回匹配物料在各合同的库存 | P0 |
| BE-BIZ-009 | 物料 upsert | POST /biz-contracts/materials/upsert | body: 物料数据 | 创建或更新物料库存 | P0 |
| BE-BIZ-010 | 更新库存 | PUT /biz-contracts/materials/:id/update-stock | body: `{current_stock}` | 库存更新，shortage_qty 重新计算 | P0 |
| BE-BIZ-011 | 更新库存-负数 | PUT .../update-stock | current_stock 为负数 | 返回错误或正确处理 | P1 |

### 4.4 分析任务模块 (`/api/analysis/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-ANA-001 | 分析任务列表 | GET /analysis | 无参数 | 返回分页列表，默认按 created_at DESC | P0 |
| BE-ANA-002 | 按 taskId 搜索 | GET /analysis?taskId=T2026 | taskId 模糊匹配 | 返回匹配任务 | P1 |
| BE-ANA-003 | 按状态筛选 | GET /analysis?status=analyzing | status 参数 | 只返回 analyzing 状态 | P1 |
| BE-ANA-004 | 排序 | GET /analysis?sortCol=createdAt&sortDir=asc | 排序参数 | 按指定列排序 | P1 |
| BE-ANA-005 | 创建任务 | POST /analysis | body: `{title, orders, agent, skillId, skillName}` | 201，返回新任务（id 格式 TYYYYMMDD###） | P0 |
| BE-ANA-006 | 创建任务-缺少权限 | POST /analysis | 无 `create_analysis` 权限 | 403 Forbidden | P0 |
| BE-ANA-007 | 任务详情 | GET /analysis/:id | 有效 id | 返回任务基本信息 | P0 |
| BE-ANA-008 | 任务详情-不存在 | GET /analysis/notexist | 无效 id | 404 | P0 |
| BE-ANA-009 | 任务完整数据 | GET /analysis/:id/full | 有效 id | 返回含 orders/categories/problems/todos 的完整数据 | P0 |
| BE-ANA-010 | 卡片详情 | GET /analysis/:id/card/:problemId | 有效 id | 返回卡片详细数据 | P0 |
| BE-ANA-011 | 保存卡片详情 | PUT /analysis/:id/card/:problemId | body: 卡片数据 | 保存成功 | P1 |
| BE-ANA-012 | 保存分析结果 | PUT /analysis/:id/result | body: `{orders, a2uiMessages}` | 数据持久化，状态变为 analyzed | P0 |
| BE-ANA-013 | 获取状态 | GET /analysis/:id/status | 有效 id | 返回 `{status}` | P1 |
| BE-ANA-014 | 更新状态 | PUT /analysis/:id/status | body: `{status: 'completed'}` | 状态更新成功 | P1 |
| BE-ANA-015 | 更新状态-无效值 | PUT /analysis/:id/status | body: `{status: 'invalid'}` | 400, `error: Invalid status` | P1 |
| BE-ANA-016 | 获取 todos | GET /analysis/:id/todos | 有效 id | 返回该任务关联的 todo 列表 | P0 |
| BE-ANA-017 | 保存 todos | POST /analysis/:id/todos | body: `{todos: [...]}` | 批量插入/更新 todos，返回 count | P0 |

### 4.5 执行任务模块 (`/api/tasks/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-TASK-001 | 任务列表 | GET /tasks | 无参数 | 返回分页任务，默认按优先级+逾期+截止日期排序 | P0 |
| BE-TASK-002 | 按类型筛选 | GET /tasks?type=agent | type 参数 | 只返回 agent 类型 | P1 |
| BE-TASK-003 | 按状态筛选 | GET /tasks?status=overdue | status 参数 | 只返回逾期任务 | P1 |
| BE-TASK-004 | 按分类筛选 | GET /tasks?category=ship | category 参数 | 返回发货相关任务 | P1 |
| BE-TASK-005 | 按负责人筛选 | GET /tasks?assignee=张伟 | assignee 参数 | 只返回张伟的任务 | P0 |
| BE-TASK-006 | 搜索 | GET /tasks?search=重工 | search 参数 | description/contractId/assignee 模糊匹配 | P1 |
| BE-TASK-007 | 数据权限 | GET /tasks | 普通用户请求 | SQL WHERE 附加数据权限条件 | P0 |
| BE-TASK-008 | 单条详情 | GET /tasks/:id | 有效 id | 返回任务详情 | P0 |
| BE-TASK-009 | 标记完成 | PUT /tasks/:id/mark-complete | 有效 id | 状态更新为 done，返回关联 analysisTaskId | P0 |
| BE-TASK-010 | 标记完成-不存在 | PUT /tasks/notexist/mark-complete | 无效 id | 404 | P0 |

### 4.6 聊天会话模块 (`/api/chat/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-CHAT-001 | 会话列表 | GET /chat/sessions | 无参数 | 返回所有会话 id/title/时间 | P1 |
| BE-CHAT-002 | 获取消息 | GET /chat/:sessionId | 有效 sessionId | 返回消息数组 | P1 |
| BE-CHAT-003 | 保存消息 | POST /chat/:sessionId | body: `{role, content}` | 保存成功 | P1 |
| BE-CHAT-004 | 批量保存 | POST /chat/:sessionId/batch | body: `{messages: [...]}` | 批量保存，返回 count | P1 |
| BE-CHAT-005 | 更新会话标题 | PUT /chat/:sessionId/title | body: `{title}` | 标题更新，超长自动截断 50 字符 | P1 |

### 4.7 RBAC 模块 (`/api/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-RBAC-001 | 组织列表 | GET /orgs | 无参数 | 返回组织扁平列表 | P1 |
| BE-RBAC-002 | 组织树 | GET /orgs/tree | 无参数 | 返回树形结构 | P1 |
| BE-RBAC-003 | 创建组织 | POST /orgs | body: `{name, parent_id}` | 创建成功 | P1 |
| BE-RBAC-004 | 用户列表 | GET /users | 分页参数 | 返回用户分页列表 | P1 |
| BE-RBAC-005 | 创建用户 | POST /users | body: 用户信息 | 创建成功 | P1 |
| BE-RBAC-006 | 更新用户 | PUT /users/:id | body: 用户信息 | 更新成功 | P1 |
| BE-RBAC-007 | 删除用户 | DELETE /users/:id | 有效 id | 删除成功 | P1 |
| BE-RBAC-008 | 角色列表 | GET /roles | 无参数 | 返回角色列表 | P1 |
| BE-RBAC-009 | 角色权限获取 | GET /roles/:id/permissions | 有效 id | 返回 menus/operations/dataScopes | P0 |
| BE-RBAC-010 | 角色权限设置 | PUT /roles/:id/permissions | body: 权限数据 | 保存成功，用户权限实时生效 | P0 |
| BE-RBAC-011 | Skill 权限获取 | GET /roles/:id/skill-permissions | 有效 id | 返回 skillIds 数组 | P0 |
| BE-RBAC-012 | Skill 权限设置 | PUT /roles/:id/skill-permissions | body: `{skillIds}` | 保存成功 | P0 |
| BE-RBAC-013 | 数据权限-范围隔离 | GET /tasks | 用户数据权限限制 assignee | SQL 附加 AND 条件，只返回指定范围 | P0 |
| BE-RBAC-014 | 数据权限-结构化规则 | GET /orders | 配置结构化 scope（rules + logic） | SQL 正确生成 AND/OR 组合条件 | P0 |
| BE-RBAC-015 | 操作权限校验 | POST /analysis | 无 `create_analysis` 权限 | 403, `error: Forbidden: missing operation 'create_analysis'` | P0 |

### 4.8 通知模块 (`/api/notifications/*`, `/api/notification-*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-NOT-001 | 渠道列表 | GET /notification-channels | 无参数 | 返回渠道列表 | P1 |
| BE-NOT-002 | 创建渠道-缺少字段 | POST /notification-channels | body: `{}` | 400, id/name/type required | P1 |
| BE-NOT-003 | 创建渠道-无效类型 | POST /notification-channels | type: "sms" | 400, type must be email/wecom/feishu/feishu_app/dingtalk/dingtalk_app | P1 |
| BE-NOT-004 | 创建渠道-邮件 | POST /notification-channels | type: "email" + config | 创建成功 | P1 |
| BE-NOT-005 | 更新渠道 | PUT /notification-channels/:id | body: `{name, config, enabled}` | 更新成功 | P1 |
| BE-NOT-006 | 删除渠道 | DELETE /notification-channels/:id | 有效 id | 删除成功 | P1 |
| BE-NOT-007 | 发送通知 | POST /notifications/send | body: `{channelId, message}` | 消息发送，自动写日志 | P0 |
| BE-NOT-008 | 发送通知-渠道不存在 | POST /notifications/send | channelId: "notexist" | 404 | P0 |
| BE-NOT-009 | 发送通知-渠道禁用 | POST /notifications/send | 渠道 enabled=false | 400, Channel is disabled | P0 |
| BE-NOT-010 | 测试通知 | POST /notifications/test/:id | 有效渠道 id | 发送测试消息，记录日志 | P1 |
| BE-NOT-011 | 模板列表 | GET /notification-templates | 无参数 | 返回模板列表（首次自动 seed 默认模板） | P1 |
| BE-NOT-012 | 日志列表 | GET /notification-logs | 分页参数 | 返回发送日志，支持 channelId/success 筛选 | P1 |
| BE-NOT-013 | 渠道健康 | GET /notification-channels/:id/health | 有效 id | 返回 lastTest 状态和详情 | P1 |

### 4.9 Subagent 模块 (`/api/subagents/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-SUB-001 | Subagent 列表 | GET /subagents | 无参数 | 返回 subagent 列表 | P1 |
| BE-SUB-002 | 创建 Subagent | POST /subagents | body: `{id, name, system_prompt}` | 201 创建成功 | P1 |
| BE-SUB-003 | 更新 Subagent | PUT /subagents/:id | body: 更新字段 | 更新成功 | P1 |
| BE-SUB-004 | 删除 Subagent | DELETE /subagents/:id | 有效 id | 删除成功 | P1 |

### 4.10 钉钉机器人回调 (`/api/dingtalk/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| BE-DT-001 | 机器人回调 | POST /api/dingtalk | 正确签名的钉钉回调 | 返回处理结果 | P0 |
| BE-DT-002 | 回调验签失败 | POST /api/dingtalk | 错误签名 | 返回验签失败 | P0 |

---

## 5. Agent Service API 测试用例

### 5.1 Skill 管理 (`/skills/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-SK-001 | 列表 Skills | GET /skills | 无参数 | 返回全部 Skill 元数据（不含 prompt body） | P0 |
| AG-SK-002 | 单条 Skill | GET /skills/:id | 有效 id | 返回 Skill 元数据 | P0 |
| AG-SK-003 | 单条 Skill-不存在 | GET /skills/notexist | 无效 id | 404 | P0 |
| AG-SK-004 | 完整 Skill | GET /skills/:id/full | 有效 id | 返回含 prompt/references/scripts/templates | P0 |
| AG-SK-005 | 原始内容 | GET /skills/:id/raw | 有效 id | 返回 SKILL.md 原始文本 | P1 |
| AG-SK-006 | 读取文件 | GET /skills/:id/files/:path | 有效文件路径 | 返回文件内容 | P1 |
| AG-SK-007 | 保存 Skill | PUT /skills/:id | body: `{content}` | 文件写入，控制台打印日志 | P0 |
| AG-SK-008 | 保存文件 | PUT /skills/:id/files/:path | body: `{content}` | 文件写入成功 | P1 |
| AG-SK-009 | 创建 Skill | POST /skills | body: `{id, name, icon, color, content}` | 创建成功，生成 SKILL.md | P0 |
| AG-SK-010 | 删除 Skill | DELETE /skills/:id | 有效 id | 删除整个 Skill 目录 | P0 |
| AG-SK-011 | 删除文件 | DELETE /skills/:id/files/:path | 有效路径 | 删除文件 | P1 |
| AG-SK-012 | 目录遍历防护 | PUT /skills/:id/files/../../etc/passwd | body: `{content}` | 400, Invalid file path | P0 |

### 5.2 Hook 管理 (`/hooks/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-HK-001 | 列表 Hooks | GET /hooks | 无参数 | 返回 Hook 列表 | P1 |
| AG-HK-002 | 创建 Hook | POST /hooks | body: `{id, name, event, script}` | 创建成功 | P1 |
| AG-HK-003 | 更新 Hook | PUT /hooks/:id | body: 更新字段 | 保存成功 | P1 |
| AG-HK-004 | 删除 Hook | DELETE /hooks/:id | 有效 id | 删除成功 | P1 |

### 5.3 MCP 管理 (`/mcp/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-MCP-001 | 列表 MCP | GET /mcp | 无参数 | 返回 MCP 服务器列表 | P1 |
| AG-MCP-002 | 创建 MCP | POST /mcp | body: `{id, name, command, args, env}` | 创建成功 | P1 |
| AG-MCP-003 | 更新 MCP | PUT /mcp/:id | body: 更新字段 | 保存成功 | P1 |
| AG-MCP-004 | 删除 MCP | DELETE /mcp/:id | 有效 id | 删除成功 | P1 |

### 5.4 插件管理 (`/plugins/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-PL-001 | 列表插件 | GET /plugins | 无参数 | 返回插件列表 | P1 |
| AG-PL-002 | 创建插件 | POST /plugins | body: `{id, name, type, entry}` | 创建成功 | P1 |
| AG-PL-003 | 更新插件 | PUT /plugins/:id | body: 更新字段 | 保存成功 | P1 |
| AG-PL-004 | 删除插件 | DELETE /plugins/:id | 有效 id | 删除成功 | P1 |

### 5.5 模型配置 (`/models/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-MD-001 | 模型列表 | GET /models | 无参数 | 返回可用模型列表 + defaultModel | P0 |
| AG-MD-002 | 配置读取 | GET /models/config | 无参数 | 返回 providers 完整配置（含 apiKey，注意脱敏） | P1 |
| AG-MD-003 | 配置保存 | PUT /models/config | body: 配置 JSON | 保存成功 | P1 |

### 5.6 定时任务 (`/cron-tasks/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-CR-001 | 列表任务 | GET /cron-tasks | 无参数 | 返回全部定时任务 | P0 |
| AG-CR-002 | 单条任务 | GET /cron-tasks/:id | 有效 id | 返回任务详情 | P1 |
| AG-CR-003 | 创建任务 | POST /cron-tasks | body: `{id, name, schedule, script}` | 创建成功 | P1 |
| AG-CR-004 | 更新任务 | PUT /cron-tasks/:id | body: `{enabled, schedule, ...}` | 更新成功，scheduler reload | P1 |
| AG-CR-005 | 删除任务 | DELETE /cron-tasks/:id | 有效 id | 删除成功，scheduler unschedule | P1 |
| AG-CR-006 | 手动执行 | POST /cron-tasks/:id/run | 有效 id | 立即执行任务，返回结果 | P1 |
| AG-CR-007 | Cron 表达式校验 | POST /cron-tasks | schedule 为无效 cron | 创建时无格式校验（需人工确认）或返回错误 | P1 |

### 5.7 Tool 管理 (`/tools/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-TL-001 | 列表 Tools | GET /tools | 无参数 | 返回工具配置列表 | P1 |
| AG-TL-002 | 启用/禁用 Tool | PUT /tools/:name | body: `{enabled: false}` | 状态切换成功 | P1 |

### 5.8 Usage 统计 (`/usage/*`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-US-001 | 汇总统计 | GET /usage/summary | 无参数 | 返回总 token 消耗、输入/输出统计 | P1 |
| AG-US-002 | 用户汇总 | GET /usage/summary?userId=xxx | userId 参数 | 返回指定用户的汇总 | P1 |
| AG-US-003 | 每日统计 | GET /usage/daily?days=7 | days 参数 | 返回最近 7 天每日数据 | P1 |
| AG-US-004 | 模型统计 | GET /usage/models | 无参数 | 返回各模型消耗分布 | P1 |

### 5.9 健康检查 (`/health`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-HE-001 | 健康状态 | GET /health | 无参数 | 返回 `{status, timestamp, mcpConnected, mcpPoolStats, mcpTools}` | P0 |

### 5.10 程序化 Agent 调用 (`/api/run-agent`)

| 编号 | 功能点 | 请求方法 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| AG-RA-001 | 正常调用 | POST /api/run-agent | body: `{skillId, prompt}` | 返回 Agent 执行结果 | P1 |
| AG-RA-002 | 缺少参数 | POST /api/run-agent | body: `{}` | 400, skillId and prompt are required | P1 |

---

## 6. WebSocket 测试用例

### 6.1 后端聊天 WebSocket (`ws://localhost:3001/ws/chat`)

| 编号 | 功能点 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|--------|
| WS-BE-001 | 建立连接 | 创建 WebSocket 连接到 `/ws/chat` | 连接成功，服务端日志输出 "Client connected" | P0 |
| WS-BE-002 | 发送聊天消息 | 发送 `{"type":"chat","sessionId":"test","message":"hello","orders":[]}` | 服务端处理，返回 chunk + complete 消息 | P0 |
| WS-BE-003 | 无 API Key 流式回退 | ANTHROPIC_API_KEY 未设置时发送消息 | 收到模拟流式 chunks，最后返回 analysisId 和 redirect | P0 |
| WS-BE-004 | 无效 JSON | 发送非 JSON 字符串 | 返回 `{"type":"error","content":"Invalid message format"}` | P1 |
| WS-BE-005 | 断线重连 | 主动断开 WebSocket，重新连接 | 新连接正常工作 | P1 |
| WS-BE-006 | 多 session 隔离 | 同一 WS 发送不同 sessionId | sessions Map 按 sessionId 分别存储 | P1 |

### 6.2 Agent Service WebSocket (`ws://localhost:3002/ws/agent`)

| 编号 | 功能点 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|--------|
| WS-AG-001 | 建立连接 | 创建 WebSocket 连接到 `/ws/agent` | 连接成功 | P0 |
| WS-AG-002 | 聊天消息-有 Skill | 发送 `{"type":"chat","sessionId":"test","skillId":"analysis-helper","message":"分析订单"}` | AgentLoop 处理，返回流式响应 | P0 |
| WS-AG-003 | 聊天消息-无 Skill | 发送 `{"type":"chat","sessionId":"test","message":"hello"}` | 返回错误：请选择一个Skill或开启自动分配 | P0 |
| WS-AG-004 | Abort 消息 | 先发送 chat，再发送 `{"type":"abort","sessionId":"test"}` | 会话被中断，返回 stopped | P0 |
| WS-AG-005 | 自动生成 todo | 发送以"请为以下合同生成待办清单"开头的消息 | 无需 skillId 即可处理 | P1 |
| WS-AG-006 | 无效消息格式 | 发送非 JSON 字符串 | 返回 error: Invalid message format | P1 |

---

## 7. 钉钉 Agent 集成测试用例

| 编号 | 功能点 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|--------|
| DT-001 | 普通消息处理 | POST `/api/dingtalk-agent` body: `{message:"查询订单",userId:"user1"}` | 返回 AI 回复内容 | P0 |
| DT-002 | 新对话命令 | 发送 `/new` 或 `/新对话` | 清除会话，返回"已开启新对话" | P0 |
| DT-003 | 意图识别 | 发送"分析一下收入" | 自动匹配到收入相关 Skill | P0 |
| DT-004 | Subagent 模式 | body 包含 `subagentId` | 使用 Subagent 的 system_prompt | P1 |
| DT-005 | 工具调用-fetch_orders | 发送"查询李明的订单" | AI 调用 fetch_orders 工具，返回订单列表 | P0 |
| DT-006 | 工具调用-fetch_biz_data | 发送"合同 HT2025xxx 的齐套情况" | AI 调用 fetch_biz_data，返回 kit-check 结果 | P0 |
| DT-007 | 工具调用-create_analysis_task | 发送"创建一个分析任务" | 创建分析任务，返回 Web 端链接 | P0 |
| DT-008 | 工具调用-generate_todos | 发送"生成待办"（已有 taskId） | 生成待办清单，返回 Web 端链接 | P0 |
| DT-009 | 工具调用-mark_task_complete | 发送"标记任务完成" | 验证库存无缺口后标记完成 | P0 |
| DT-010 | 会话过期 | 等待 30 分钟不活跃后再次发送 | 旧会话被清除，创建新会话 | P1 |
| DT-011 | 消息长度限制 | 发送超长消息 | 正常处理或合理截断 | P1 |
| DT-012 | 返回链接格式 | 创建分析任务后 | 回复中必须包含 `http://localhost:5173/analysis/xxx` 完整链接 | P0 |

---

## 8. 端到端场景测试用例

| 编号 | 场景 | 测试步骤 | 预期结果 | 优先级 |
|------|------|----------|----------|--------|
| E2E-001 | 完整订单分析流程 | 1. 首页选择多个异常订单<br>2. 加入对话，选择分析 Skill<br>3. AI 分析生成看板<br>4. 在看板页面查看问题卡片<br>5. 生成待办任务<br>6. 到任务列表执行并标记完成 | 数据流转正确，状态依次：analyzing → analyzed → todos_generated → completed | P0 |
| E2E-002 | 钉钉发起分析 → Web 查看 | 1. 钉钉发送"分析所有异常订单"<br>2. Agent 创建分析任务<br>3. 用户点击返回的 Web 链接<br>4. Web 端正确展示看板 | Web 端数据与钉钉创建的任务一致 | P0 |
| E2E-003 | 通知渠道完整链路 | 1. 创建邮件通知渠道<br>2. 点击测试发送<br>3. 查看通知日志<br>4. 查看渠道健康状态 | 测试邮件发送成功，日志记录正确，健康状态 healthy | P1 |
| E2E-004 | RBAC 权限隔离 | 1. 创建角色 A，数据权限限制 assignee=张伟<br>2. 给用户绑定角色 A<br>3. 用户登录查看任务列表 | 只能看到 assignee=张伟 的任务 | P0 |
| E2E-005 | Skill 权限隔离 | 1. 给角色只授权部分 Skill<br>2. 用户登录查看 AI 助手面板 | 下拉框只显示被授权的 Skill | P0 |
| E2E-006 | 定时任务执行 | 1. 创建一个每分钟执行的测试任务<br>2. 等待触发或手动执行<br>3. 查看执行日志 | 任务按计划触发，日志记录正确 | P1 |
| E2E-007 | LLM 模型切换 | 1. 在设置页切换默认模型<br>2. 在 AI 助手发送消息<br>3. 观察 Token 消耗统计 | 请求使用新模型，统计归属正确 | P1 |
| E2E-008 | 多用户会话隔离 | 1. 用户 A 和用户 B 同时与 AI 对话<br>2. 各自发送不同的上下文 | 两者的对话历史互不干扰 | P0 |

---

## 9. 安全测试用例

| 编号 | 功能点 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|--------|
| SEC-001 | SQL 注入-订单筛选 | GET `/orders?customer=' OR '1'='1` | 参数被安全处理，不会返回全部数据 | P0 |
| SEC-002 | SQL 注入-任务搜索 | GET `/tasks?search='; DROP TABLE analysis_todos;--` | 搜索词被转义，不会执行恶意 SQL | P0 |
| SEC-003 | SQL 注入-数据权限 | 在数据权限规则中注入 `' OR '1'='1` | escapeSql 正确处理单引号转义 | P0 |
| SEC-004 | 目录遍历-Skill 文件 | PUT `/skills/test/files/../../../etc/passwd` | 400, Invalid file path | P0 |
| SEC-005 | JWT 伪造 | 使用随机字符串作为 Bearer token | 验证失败，fallback 为匿名用户 | P0 |
| SEC-006 | 越权访问 | 普通用户尝试访问 admin-only 接口（如创建 Skill） | 如无权限则 403 或返回空数据 | P0 |
| SEC-007 | XSS-聊天消息 | 发送包含 `<script>alert(1)</script>` 的消息 | 前端正确转义，不执行脚本 | P0 |
| SEC-008 | XSS-分析任务标题 | 创建任务时 title 包含 XSS payload | 存储和展示时都正确转义 | P0 |
| SEC-009 | 密码存储 | 检查 DB 中 users.password_hash | 密码使用 SHA-256 哈希存储，非明文 | P0 |
| SEC-010 | 敏感信息泄露 | GET `/models/config` | apiKey 应脱敏或限制访问（当前无 authMiddleware 保护） | P1 |
| SEC-011 | 速率限制 | 短时间内大量请求 `/api/dingtalk-agent` | 建议增加速率限制（当前无） | P2 |
| SEC-012 | 文件上传限制 | Skill 文件保存超大内容（>10MB） | 应有大小限制或超时保护 | P1 |

---

## 10. 性能测试用例

| 编号 | 功能点 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|--------|
| PERF-001 | 订单列表响应时间 | GET `/orders?page=1&pageSize=20` | <= 200ms | P1 |
| PERF-002 | 订单列表大数据量 | GET `/orders?page=1&pageSize=100` | <= 500ms | P1 |
| PERF-003 | 分析任务创建并发 | 并发 10 请求 POST `/analysis` | 全部成功，无重复 id 冲突 | P1 |
| PERF-004 | 任务列表大数据量 | GET `/tasks?pageSize=200` | <= 500ms | P1 |
| PERF-005 | WebSocket 并发连接 | 同时建立 100 个 WS 连接 | 服务端稳定，内存无明显泄漏 | P1 |
| PERF-006 | Agent Loop 响应时间 | 发送简单消息到 `/ws/agent` | 首包返回 <= 3s（含 LLM 调用） | P1 |
| PERF-007 | 钉钉 Agent 并发 | 并发 20 请求 `/api/dingtalk-agent` | 无 500 错误，会话隔离正确 | P1 |
| PERF-008 | MCP Pool 连接稳定性 | 长时间运行（24h） | 4/4 clients 保持连接，无断开 | P1 |
| PERF-009 | 前端首屏加载 | Lighthouse 性能审计 | LCP <= 2.5s, CLS <= 0.1 | P1 |
| PERF-010 | 内存泄漏检查 | 反复切换页面/打开关闭 AI 面板 | 内存使用稳定，无持续增长 | P2 |

---

## 11. 兼容性测试用例

| 编号 | 功能点 | 测试环境 | 测试步骤 | 预期结果 | 优先级 |
|------|--------|----------|----------|----------|--------|
| COMP-001 | Chrome 最新版 | Chrome 130+ | 全功能回归 | 所有功能正常 | P0 |
| COMP-002 | Edge 最新版 | Edge 130+ | 全功能回归 | 所有功能正常 | P0 |
| COMP-003 | Safari | Safari 17+ | 核心功能回归 | 页面渲染、WebSocket、AI 面板正常 | P1 |
| COMP-004 | 移动端适配 | iPhone 15 Pro / Android Chrome | 访问首页和看板 | 布局自适应，核心功能可用 | P1 |
| COMP-005 | 暗色模式切换 | 各浏览器 | 切换暗色/亮色 | 主题正确切换，无闪烁 | P2 |

---

## 12. 回归测试清单（每次发版必测）

- [ ] 登录/登出正常
- [ ] 首页订单列表加载、筛选、分页正常
- [ ] AI 助手面板 Skill 下拉加载、选择、发送消息正常
- [ ] WebSocket 流式回复正常
- [ ] 创建分析任务并查看看板正常
- [ ] 生成待办任务正常
- [ ] 标记任务完成正常
- [ ] 系统设置各 Tab 加载和保存正常
- [ ] 定时任务列表有数据
- [ ] Skill 管理列表有数据
- [ ] 通知渠道测试发送正常
- [ ] 钉钉 Agent 普通消息回复正常
- [ ] 暗色模式切换正常
- [ ] Token 消耗统计面板数据正确

---

## 附录 A：测试数据准备

```sql
-- 测试用户
INSERT INTO users (id, username, password_hash, display_name, enabled, org_id) VALUES
('user_test', 'testuser', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', '测试用户', 1, 'org_root');
-- 密码: password

-- 测试角色
INSERT INTO roles (id, name, description) VALUES
('role_test', '测试角色', '用于自动化测试');

-- 绑定角色权限
INSERT INTO user_roles (user_id, role_id) VALUES ('user_test', 'role_test');
INSERT INTO role_permissions (role_id, permission_type, resource_id) VALUES
('role_test', 'menu', 'menu_settings_skills'),
('role_test', 'operation', 'create_analysis');
```

## 附录 B：自动化测试脚本示例

```typescript
// frontend/tests/orders.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import HomePage from '../src/pages/HomePage'

describe('订单列表', () => {
  it('FE-ORD-001: 加载订单列表', async () => {
    render(<HomePage />)
    expect(await screen.findByText('共')).toBeInTheDocument()
    expect(await screen.findByText('60')).toBeInTheDocument()
  })

  it('FE-ORD-005: 按签收状态筛选', async () => {
    render(<HomePage />)
    // 模拟选择"未签收"
    // expect 筛选后的结果...
  })
})

// backend/tests/orders.api.test.ts
import request from 'supertest'
import app from '../src/index'

describe('订单 API', () => {
  it('BE-ORD-001: 列表无筛选', async () => {
    const res = await request(app).get('/api/orders')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(60)
  })

  it('BE-ORD-013: 详情不存在', async () => {
    const res = await request(app).get('/api/orders/notexist')
    expect(res.status).toBe(404)
  })
})
```
