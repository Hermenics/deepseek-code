# C4 — Containers

The system is one local CLI process; these are logical runtime containers, not separately deployed services.

```mermaid
flowchart TB
  subgraph Bun[DeepSeek Code Bun process]
    CLI[CLI and pipe entrypoints]
    TUI[React terminal UI]
    Core[Agent and provider adapters]
    Control[Authorization and hooks]
    Tasks[Task orchestration]
    Ext[Plugin, skill, MCP and LSP adapters]
    Store[Session, memory, settings and audit stores]
  end
  CLI --> TUI
  CLI --> Core
  TUI --> Core
  Core --> Control
  Core --> Tasks
  Core --> Ext
  Core --> Store
  Control --> Workspace[Workspace / Git]
  Tasks --> Workspace
  Core --> Providers[Model APIs]
  Ext --> Processes[Approved child processes]
```

| Logical container | Responsibility | Technology |
| --- | --- | --- |
| CLI/pipe | Parse invocation, select flow, protect piped commands | Bun TypeScript |
| TUI | Conversation, prompts, approval surfaces, task presentation | React 19 + in-tree Ink/Yoga |
| Agent core | Initialize context, loop model/tools, compact and persist sessions | TypeScript + OpenAI SDK/provider adapters |
| Control plane | Mode, permissions, risk, hooks and safe paths | TypeScript |
| Orchestration | Task lifecycle, mailbox, worktree, snapshots and review | TypeScript + Git |
| Local stores | Operational state, atomically persisted/redacted where needed | JSON/JSONL + filesystem |
