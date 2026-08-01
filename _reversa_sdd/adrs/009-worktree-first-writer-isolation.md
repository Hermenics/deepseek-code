# ADR 009 — Prefer owned worktrees for writing tasks

**Status:** accepted. **Evidence:** `src/orchestration/worktrees.ts` and integration flow. **Confidence:** 🟢

## Decision

Run writer tasks in owned detached Git worktrees when safe, then integrate a checked binary diff. Fall back to serialized shared writing when worktree creation is not safe.

## Alternatives considered

- Let concurrent writers edit the same checkout.
- Require worktrees and reject every non-clean workspace.

## Consequences

- Parallel changes have a controlled integration boundary.
- Non-Git or dirty workspaces still work, with reduced writer concurrency.

