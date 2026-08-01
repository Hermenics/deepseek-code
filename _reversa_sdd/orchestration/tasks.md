# Orchestration — implementation tasks

## Prerequisites

- [ ] The task schema, event store, and local Git workspace are available.

- [ ] T-01 Define versioned task schemas, limits, and legal transitions.
  - Origin: `src/orchestration/types.ts`, `lifecycle.ts`
  - Done when: invalid state/limit/graph input is rejected.
  - Confidence: 🟢
- [ ] T-02 Implement registry scheduling, dependency policies, retry and cancellation.
  - Origin: `src/orchestration/TaskRegistry.ts`
  - Done when: the documented task state diagram is executable in tests.
  - Confidence: 🟢
- [ ] T-03 Persist/recover snapshots and event logs safely.
  - Origin: `src/orchestration/snapshot.ts`, `events.ts`, `lease.ts`
  - Done when: interrupted running work does not resume as false success.
  - Confidence: 🟢
- [ ] T-04 Implement worktree ownership and checked integration.
  - Origin: `src/orchestration/worktrees.ts`
  - Done when: unsafe/dirty integration is blocked.
  - Confidence: 🟢

## Tests

- [ ] TT-01 Dependency success/unblock and failed-policy paths.
- [ ] TT-02 Timeout/retry/restore and worktree-conflict paths.
