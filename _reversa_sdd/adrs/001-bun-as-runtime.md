# ADR-001: Bun as Runtime

> Status: ACCEPTED  
> Date: 2026 (inferred from project inception)  
> Confidence: 🟢 CONFIRMED

## Context

The project needed a JavaScript/TypeScript runtime for a CLI tool that would:
- Start fast (interactive TUI)
- Support TypeScript natively without a compile step
- Handle file I/O, child processes, and HTTP efficiently
- Be distributed as a single binary or simple npm package

## Decision

Use **Bun** as the sole runtime instead of Node.js.

## Rationale

1. Native TypeScript execution — no tsc build step required for development
2. Faster startup time than Node.js (important for CLI responsiveness)
3. Built-in test runner (Vitest-compatible) via `bun test`
4. Built-in bundler for production builds (`bun run build`)
5. Compatible with npm ecosystem and OpenAI SDK

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Node.js + tsc | Slower startup, requires build step, more complex dev setup |
| Deno | Less npm compatibility at the time, different module resolution |
| Go/Rust | Would lose access to React/Ink ecosystem for TUI |

## Consequences

- **Positive:** Zero-config TypeScript, fast dev loop, single tool for run/test/build
- **Negative:** Some npm packages have Bun-specific quirks (e.g., `mock.module` leaking across tests — see commit `84524ea`)
- **Negative:** Bun's module resolution occasionally differs from Node.js, causing CI issues (commit `158ae91`: pin Bun to 1.3.13)
- **Constraint:** Must verify third-party packages work correctly under Bun, not just Node.js
