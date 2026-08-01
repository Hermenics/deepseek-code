# Mission Control — Architecture

## Current Architecture

```
TUI (App.tsx) — owns session, goal timers, save timers, continuation scheduling
  ├── Agent Loop (agent/) — model calls, tool execution
  ├── Goal (agent/goal.ts) — module-level singleton, no persistence in save
  ├── Hooks (hooks/) — 3 events (PreToolUse, PostToolUse, SessionStart), shell-only
  ├── Orchestration (orchestration/) — in-memory TaskRegistry, workspaces, mailbox
  │   ├── TaskRegistry — DAG, spawn, claims, retries, events
  │   ├── OrchestratorSession — facade, snapshot, integration
  │   ├── TaskWorkspaceManager — git-worktree, serialized-writer, patch+apply
  │   ├── TaskMailbox — ordered, deduplicated, acknowledged messages
  │   ├── TaskEventSink — in-memory + JSONL log, secret redaction
  │   └── TaskSnapshotStore — atomic write, schema validation
  └── Session (agent/session.ts) — JSON file per session
```

## Target Architecture

```
Orchestration Kernel (src/kernel/) — framework-independent, no TUI imports
  ├── Store (SQLite WAL)
  ├── Event Bus (append-only, replayable)
  ├── Scheduler (task DAG, claims, leases)
  ├── Thread Runtime (serializable AgentSpec, resumable)
  ├── Mailbox (peer-to-peer, idempotent)
  ├── Workspace Manager (isolated, path ownership)
  ├── Hook Runtime (broad lifecycle, trust, audit)
  ├── Goal Engine (criteria/evidence, independent evaluator)
  └── Observability (traces, replay, retention)

Adapters
  ├── TUI Client (subscriber to kernel events)
  ├── CLI Client (thin command handlers)
  ├── MCP Adapter
  └── A2A Adapter (future)
```

## Key ADRs

1. **SQLite WAL** — Bun's `bun:sqlite` in WAL mode
2. **Append-only event log** — event + materialized state in same transaction
3. **Serializable AgentSpec** — data over closures for durability
4. **Independent verifier** — not worker self-reporting
5. **Path leases** — declared owns_paths, enforced by workspace manager
6. **Trust-by-hash** — project hooks trusted by content hash
7. **Phased migration** — Phase 1 independent, Phase 2+ with compat adapters
