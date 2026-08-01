# ADR 001 — Bun is the runtime and test runner

**Status:** accepted. **Evidence:** `package.json`, CI, release history. **Confidence:** 🟢

## Decision

Ship DeepSeek Code as a Bun CLI and run its TypeScript test suite with `bun test`. The supported engine is Bun 1.1 or newer.

## Alternatives considered

- Node.js plus a separate TypeScript runtime and test runner.
- A compiled JavaScript distribution with multiple runtime targets.

## Consequences

- The project gets a single execution, build, and test path.
- Runtime-specific APIs and release artifacts require Bun-compatible environments.

