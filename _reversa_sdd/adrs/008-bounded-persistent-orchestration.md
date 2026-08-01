# ADR 008 — Orchestrate bounded, persistent tasks

**Status:** accepted. **Evidence:** commit `62fe183`, `src/orchestration/`. **Confidence:** 🟢

## Decision

Represent delegated work as a validated task graph with explicit state, limits, structured results, durable snapshots, retries, and dependency policies.

## Alternatives considered

- Fire-and-forget subagent calls with no registry.
- An unbounded recursive task tree.

## Consequences

- Operators can inspect, restore, cancel, and reason about delegated work.
- Limits constrain autonomy and prevent one turn from creating an uncontrolled task explosion.

