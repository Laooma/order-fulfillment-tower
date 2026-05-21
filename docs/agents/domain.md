# Domain Docs

## Layout

Single-context: one global `CONTEXT.md` at the repo root.

## Consumer rules

- Read `CONTEXT.md` first to understand the project domain
- Read `docs/adr/` for past architectural decisions
- Read `需求/order-command/PRD-订单履约控制塔.md` for product requirements

## Context map

```
task-order-1/
├── CONTEXT.md              # Project domain context
├── docs/adr/               # Architecture decision records
├── docs/agents/            # Agent skill configuration
├── 需求/order-command/      # Product requirements + prototypes
├── 引用的技术架构/          # Backend framework reference
└── frontend/               # React frontend application
```
