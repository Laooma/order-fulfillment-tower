# Issue Tracker

This project uses a **local markdown** issue tracker.

## Workflow

- Issues live as markdown files under `.scratch/<feature>/`
- Each issue is a separate `.md` file
- Issue files follow a simple frontmatter format

## Creating issues

Create a new file under `.scratch/<feature-name>/`:

```markdown
---
id: ISSUE-001
title: Brief description
status: open
labels: [needs-triage]
created: 2026-05-15
---

## Description

Detailed description here.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

## Directory structure

```
.scratch/
├── frontend/
│   ├── issue-001-homepage-layout.md
│   └── issue-002-analysis-board.md
├── backend/
│   └── issue-003-websocket-api.md
└── design/
    └── issue-004-kanban-prototype.md
```
