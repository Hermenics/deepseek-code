# Orchestration — technical design

## Interfaces

| Symbol | Contract |
| --- | --- |
| `TaskRegistry` | Owns task records, legal transitions, scheduling and completion promises. |
| `TaskRecordV1` / envelope | Versioned persisted task identity, state, limits, result and metrics. |
| `OrchestratorSession` | Coordinates registry, snapshots, workspaces and event routing. |

## Main flow

1. Validate spawn identity, parent/depth/fan-out/dependencies and limits. 🟢
2. Queue tasks whose dependencies are done; block those still waiting. 🟢
3. Run with abort/deadline, validate envelope/budget, then transition to terminal/retry state. 🟢
4. Persist redacted events/snapshot atomically; restore safely after restart. 🟢

## Failure policy

Dependency failure follows `block`, `fail`, or `cancel`; runners unavailable after restart can be resumed. Worktree integration screens sensitive paths, dirty conflicts, and `git apply --check`. 🟢

## Dependencies

Agent subagent runner, filesystem leases, Git, settings, and UI task state. 🟢
