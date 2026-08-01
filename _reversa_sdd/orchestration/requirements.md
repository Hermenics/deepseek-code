# Orchestration

## Overview

Orchestration manages bounded delegated work as a persistent, dependency-aware task graph. 🟢

## Responsibilities

- Admit unique, acyclic tasks within task/depth/fan-out/budget limits. 🟢
- Schedule, retry, block, cancel, snapshot, and restore tasks lawfully. 🟢
- Isolate writers in owned worktrees when safe and integrate checked diffs. 🟢

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| OR-RF-01 | A task must have a legal lifecycle and structured result envelope. 🟢 | Must |
| OR-RF-02 | Dependents may run only after all dependencies are done. 🟢 | Must |
| OR-RF-03 | A retryable task may retry only within configured limit/backoff. 🟢 | Must |
| OR-RF-04 | Writer work must prefer isolated worktrees with serialized fallback. 🟢 | Must |

## Non-functional requirements

Atomic snapshots, 0600 operational files, and limit normalization bound recovery and resource use. `src/orchestration/`. 🟢

## Acceptance criteria

```gherkin
Given task B depends on task A
When A succeeds
Then B becomes eligible for scheduling

Given a cyclic or over-limit spawn request
When it is admitted
Then it is rejected without creating runnable work
```

## Traceability

`TaskRegistry.ts`, `lifecycle.ts`, `schema.ts`, `worktrees.ts`, `OrchestratorSession.ts`. 🟢
