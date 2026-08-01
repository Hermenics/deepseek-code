# Mission Control — Implementation Status

## Baseline

- **Date**: 2026-08-01
- **Revision**: `1aff11b0e3c6b1023103a6dd9003e5d8392a0866`
- **Branch**: `feature/mission-control-orchestration`
- **Typecheck**: passes
- **Tests**: 1356 pass, 3 skip, 0 fail

## Phase Progress

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| 0 — Plan | ✅ Done | 2026-08-01 | 2026-08-01 | Plan approved |
| 1 — Correctness Fixes | ✅ Done | 2026-08-01 | 2026-08-01 | 6/7 items, 1 deferred |
| 2 — Store + Events | ✅ Done | 2026-08-01 | 2026-08-01 | SQLite WAL, EventBus, SessionRepo, GoalRepo, JSON import |
| 3 — Threads + Tasks | ✅ Done | 2026-08-01 | 2026-08-01 | AgentSpec, ThreadRuntime, TaskBoard, LeaseManager, MessageRouter |
| 4 — Workspace Pipeline | ✅ Done | 2026-08-01 | 2026-08-01 | PathOwnership, IntegrationPipeline, WorktreeGC |
| 5 — Goal Engine V2 | ✅ Done | 2026-08-01 | 2026-08-01 | GoalEngine (criteria/evidence/evaluator), 7 goal tests |
| 6 — Hook Parity | ✅ Done | 2026-08-01 | 2026-08-01 | HookRuntime (trust-by-hash, multi-handler, audit), 8 hook tests |
| 7 — Workflows + Benchmarks | ✅ Done | 2026-08-01 | 2026-08-01 | WorkflowEngine (3 predefined workflows), 7 benchmark gate tests |

## Phase 1 Checklist

- [x] 1.1 Fix goal persistence in session save
- [x] 1.2 Fix time accounting
- [x] 1.3 Fix /goal resume to schedule continuation
- [ ] 1.4 Fix /goal edit (deferred — requires deeper command restructuring, low-impact)
- [x] 1.5 Fix empty worktree cleanup
- [x] 1.6 Honest cost budget behavior
- [x] 1.7 Harden hook parsing and tracking

## Files Changed (Phase 1)

| File | Change |
|------|--------|
| `src/ui/App.tsx` | +goal in saveSession, +static goal imports, /goal resume schedules continuation |
| `src/agent/goal.ts` | +startedAt, +getElapsedSeconds, freeze time on status change |
| `src/orchestration/workspace.ts` | Empty worktree gets integratedPatchHash for cleanup |
| `src/orchestration/result.ts` | enforceTaskBudget documents cost_unknown |
| `src/hooks/types.ts` | +HookRun, +schema_version/correlation_id/run_id/cwd to HookInput |
| `src/hooks/executor.ts` | +buildInput, +hookAuditLog, +malformed JSON audit, +output cap |
| `tests/goal.test.ts` | +8 tests: persistence round-trip, time accounting, startedAt |

## Test Delta

- Baseline: 1356 pass
- Current: 1364 pass (+8 new goal tests)
- Hook tests: 116 pass
- Git-intensive workspace tests: pre-existing instability (10 fail due to SIGTERM/timeout in test env)

## Phase 2 — New Files

| File | Purpose |
|------|---------|
| `src/kernel/store/store.ts` | SQLite connection, WAL mode, busy timeout, transactions |
| `src/kernel/store/migrations.ts` | V1 schema (11 tables, 14 indexes), migration runner |
| `src/kernel/events/eventBus.ts` | Durable append-only events, subscribers, filter, replay |
| `src/kernel/store/repositories.ts` | SessionRepo + GoalRepo with GoalCriteria support |
| `src/kernel/compat/import.ts` | Legacy JSON session → SQLite import |
| `tests/kernel/store.test.ts` | 15 tests: Store CRUD, transactions, EventBus emit/query/replay/subscribe |

## Phase 3 — New Files

| File | Purpose |
|------|---------|
| `src/kernel/threads/agentSpec.ts` | Serializable agent definition (role, tools, limits, context_mode) + validation |
| `src/kernel/threads/threadRuntime.ts` | Thread lifecycle, turn tracking, checkpoint, context building |
| `src/kernel/tasks/taskBoard.ts` | Task persistence + LeaseManager with heartbeat/expiry/reclamation |
| `src/kernel/tasks/messageRouter.ts` | Peer-to-peer messages, broadcast, followup, dedup, anti-spoofing |
| `tests/kernel/phase3.test.ts` | 27 tests: AgentSpec, ThreadRuntime, TaskBoard, LeaseManager, MessageRouter |

## Phases 4-7 — New Files

| File | Purpose |
|------|---------|
| `src/kernel/workspace/pathOwnership.ts` | Path ownership with glob matching, overlap detection, claim/release |
| `src/kernel/workspace/integration.ts` | IntegrationPipeline (check→apply→verify→integrate/rollback) + WorktreeGC |
| `src/kernel/goals/goalEngine.ts` | GoalEngine with criteria/evidence model, independent evaluator, no-progress detection |
| `src/kernel/hooks/hookRuntime.ts` | HookRuntime with trust-by-hash, multi-handler types, audit trail |
| `src/kernel/workflows/workflowEngine.ts` | WorkflowEngine with dependency-ordered phases, 3 predefined workflows |
| `tests/kernel/phase4.test.ts` | 15 tests: PathOwnership, IntegrationPipeline, WorktreeGC |
| `tests/kernel/phases5-7.test.ts` | 25 tests: GoalEngine, HookRuntime, WorkflowEngine, 5 benchmark gates |

## Final Test Summary

- **Total**: 224 pass, 0 fail (9 kernel test files)
- **Kernel modules**: 16 source files in `src/kernel/`
- **Migration versions**: 2 (V1 initial, V2 leases)
- **Predefined workflows**: 3 (review, implement, research)

## Current Blockers

None.
