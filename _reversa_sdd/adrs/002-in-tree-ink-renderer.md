# ADR 002 — Keep the terminal renderer in-tree

**Status:** accepted. **Evidence:** `src/ink/`, renderer fixes in Git history. **Confidence:** 🟢

## Decision

Maintain a custom Ink-compatible React renderer and local Yoga layout implementation instead of delegating terminal rendering to an opaque external renderer.

## Alternatives considered

- Use an external terminal UI library unchanged.
- Render strings imperatively from application components.

## Consequences

- Rendering behavior, Unicode width, focus, scrolling, and resize policy remain controllable.
- The project owns renderer correctness and must maintain the compatibility boundary.

