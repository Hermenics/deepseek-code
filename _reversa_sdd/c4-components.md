# C4 — Components

## Agent execution container

```mermaid
flowchart LR
  Input[User input] --> Init[Agent initialization]
  Init --> Context[Steering, settings, session and memory]
  Context --> Loop[Bounded model/tool loop]
  Loop --> Provider[Provider adapter]
  Provider --> Loop
  Loop --> Guard[Validate and authorize tool call]
  Guard --> Registry[Tool registry]
  Registry --> Guard
  Guard --> Loop
  Loop --> Compact[Context compaction]
  Loop --> Output[Assistant response / callbacks]
```

| Component | Primary responsibility |
| --- | --- |
| `Agent` | Coordinates initialization, transcript, provider calls, tools and callbacks. |
| provider adapters | Normalize DeepSeek/OpenAI-compatible, Bedrock, Vertex and local behavior. |
| memory/session | Supply safe persistent context and project-isolated history. |
| compaction service | Preserve a bounded useful transcript. |
| tool execution gate | Enforces mode, paths, risks, policy and hooks before calling a tool. |

## Task orchestration container

```mermaid
flowchart LR
  Spawn[spawn request] --> Registry[TaskRegistry]
  Registry --> Graph[validate graph and limits]
  Graph --> Scheduler[queue / scheduler]
  Scheduler --> Runner[role/profile constrained runner]
  Runner --> Result[validated result envelope]
  Result --> Registry
  Registry --> Snapshot[atomic snapshot and events]
  Registry --> Worktree[owned worktree / serialized fallback]
  Worktree --> Integrate[checked diff integration]
```

## TUI renderer container

The custom renderer reconciles React elements into terminal layout nodes and ANSI frames. It centralizes Unicode cell width, focus, scroll, resize and terminal ownership; application components describe UI rather than write raw stdout. 🟢
