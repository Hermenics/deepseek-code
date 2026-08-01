# ADR 012 — Make multi-turn goals explicit and bounded

**Status:** accepted. **Evidence:** commits `385284c`, `31b5082`, `src/agent/goal.ts`. **Confidence:** 🟢

## Decision

Model long-running intent as one explicit goal with a configurable continuation cap and repeated-blocker rule.

## Alternatives considered

- Let the agent autonomously continue without an object or cap.
- Treat every request as a disconnected turn.

## Consequences

- Goal progress and termination reasons are inspectable.
- Long jobs deliberately stop for budget, usage, completion, or repeated blocking rather than continuing indefinitely.

