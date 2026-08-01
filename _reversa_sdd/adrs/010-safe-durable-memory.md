# ADR 010 — Store memory as bounded, untrusted operational context

**Status:** accepted. **Evidence:** commit `b31724d`, `src/agent/memory.ts`. **Confidence:** 🟢

## Decision

Persist bounded user/project memory with atomic writes, restrictive permissions, migration, and instruction-override filtering. Treat loaded memory as untrusted context rather than authority.

## Alternatives considered

- Keep memory only in the transient transcript.
- Permit arbitrary persistent prose to change agent policy.

## Consequences

- Repeated work can retain useful context without making stored text a policy-injection channel.
- Memory remains intentionally small and cannot replace source-of-truth project guidance.

