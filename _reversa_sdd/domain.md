# DeepSeek Code domain model

_Re-extracted on 2026-08-01 from source at `69ccd33` (v0.4.15)._
_Confidence: 🟢 confirmed by implementation unless marked otherwise._

DeepSeek Code is a local, terminal-native coding agent. Its domain is not a remote service or a database-backed product: it coordinates a provider-backed agent, the local workspace, explicit operator consent, and persistent local state.

## Ubiquitous language

| Term | Meaning | Confidence |
| --- | --- | --- |
| **Agent turn** | One user request plus the model/tool loop that addresses it. A turn is capped at 100 loop iterations. | 🟢 |
| **Workspace** | The canonical project directory in which a session operates. Files outside it require explicit path approval and sensitive paths remain denied. | 🟢 |
| **Session** | Locally persisted conversation and runtime state, keyed by a hash of the absolute project path. | 🟢 |
| **Goal** | A single durable objective with usage counters, continuation limit, and lifecycle status. | 🟢 |
| **Task** | A bounded unit delegated through the orchestration registry, optionally dependent on other tasks. | 🟢 |
| **Tool call** | A schema-validated request to inspect, change, execute, delegate, or integrate. It is authorized before execution. | 🟢 |
| **Interaction mode** | Operator-selected capability envelope: `plan`, `review`, `build`, or `auto`. | 🟢 |
| **Risk rule** | A built-in or configured classification that can require confirmation independently of mode. | 🟢 |
| **Permission rule** | A configured allow, deny, or ask decision for a tool/path pattern. | 🟢 |
| **Plugin / skill** | An installed extension managed from a validated Git source and registered in local storage. | 🟢 |
| **Project MCP server** | A workspace-declared MCP server that is not loaded until the operator enables the user-scoped opt-in. | 🟢 |

## Domain rules

### Agent and context

1. Agent initialization must finish before a turn uses settings, steering files, memory, MCP tools, or hooks. Provider setup is therefore not equivalent to the agent being ready. 🟢
2. A normal turn retains a bounded transcript. Automatic compaction runs near the configured context threshold; repeated compaction failures trip a circuit breaker instead of endlessly retrying. 🟢
3. Prompt refinement is skipped for slash commands and messages below the configured minimum length (default 30 characters). 🟢
4. Model output never executes tools directly. Each call is schema-validated, authorized, audited, executed, and returned as tool context to the model. 🟢
5. Tool output and exported session material are treated as potentially sensitive; audit and export paths redact secrets. 🟢

### Workspace, settings, and persistence

6. A session belongs to one canonical workspace. Its storage location includes a stable hash of the absolute workspace path, preventing same-named projects from sharing history. 🟢
7. Settings merge from legacy/default, user, project, and local scopes. Executable capability is intentionally user-scoped: project/local settings cannot activate hooks, LSP commands, project MCP, or `auto` as the default mode. 🟢
8. Local persisted files that contain operational state are written atomically with restrictive permissions where supported. Memory and orchestration snapshots additionally use a lease/ownership strategy to avoid concurrent corruption. 🟢
9. Imported/legacy state is migrated only after validation; untrusted memory cannot override policy or permission instructions. 🟢

### Goals and continuations

10. There is at most one current goal in the in-process goal store. Creating a new goal replaces the current in-memory goal; the UI prevents creating a new unfinished goal through its command path. 🟢
11. A goal records token and elapsed-time usage. A configured per-goal continuation limit, defaulting to three, bounds automatic continuation. 🟢
12. A goal may be marked `blocked` only after the same blocker has recurred for three consecutive attempts. A different blocker starts a new count; resuming a non-complete goal clears the count and reason. 🟢
13. `complete` is terminal for resume behavior: a completed goal is returned unchanged by `resumeGoal`. 🟢

### Orchestrated tasks

14. A task has a unique identifier, validated dependency graph, finite depth/fan-out/timeout/retry/budget limits, and a structured result envelope. Invalid graph relationships, including self-dependencies and cycles, are rejected at admission or restore. 🟢
15. Dependents run only after all dependencies are `done`. A failed dependency is handled by its declared `block`, `fail`, or `cancel` policy. 🟢
16. Recovered tasks that were running at process loss are not assumed complete; runtime recovery turns them into retryable failure handling. 🟢
17. Writer isolation prefers owned Git worktrees. When a clean detached worktree cannot be safely created, the system falls back to serialized shared-workspace access rather than concurrent writers. 🟢
18. A worktree result is integrated only after a safe binary-diff check and conflict/sensitive-path screening. 🟢

### Authority and extensions

19. Interaction mode is a first authorization gate, not the only one. `auto` removes that mode gate but does not remove path safety, risk assessment, hook behavior, or configured permission decisions. 🟢
20. The model cannot activate `auto`; only the operator can. 🟢
21. High-risk operations retain confirmation requirements even when low-risk auto-approval is enabled. A deny rule wins before allow/ask processing. 🟢
22. Subagents receive the narrowest role inferred from their request when no role is explicit. Their profile/tool allowlist is enforced again at execution time. 🟢
23. Project MCP definitions are inert until the user-scope MCP flag is enabled and the agent is restarted. Their child process receives a minimal environment. 🟢
24. Plugin and skill installation accepts only validated repository/source layouts and safe names; an update keeps a backup so failed replacement can be restored. 🟢

## Non-domain observations and gaps

- The product has no application database or end-user RBAC model. Its authorization model controls a local operator, tools, filesystem locations, and delegated roles. 🟢
- There is no evidence of telemetry or business-event logs shipped by the repository; audit and orchestration events are local operational records. 🟡
- Goal storage is process-global in `agent/goal.ts`; persistence across a process boundary is mediated by sessions/UI integration rather than by that module alone. The exact durability boundary should be verified before claiming durable goals survive every termination mode. 🟡
