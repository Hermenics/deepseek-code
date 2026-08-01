# ADR 011 — Isolate sessions by canonical project path

**Status:** accepted. **Evidence:** commit `ed5ed88`, `src/agent/session.ts`. **Confidence:** 🟢

## Decision

Store session data under a directory derived from the canonical workspace path and migrate older layouts when valid.

## Alternatives considered

- A global shared session store keyed only by session name.
- No session migration from previous releases.

## Consequences

- Separate checkouts no longer mix conversations because their folder names match.
- Session tooling must preserve path canonicalization and migration compatibility.

