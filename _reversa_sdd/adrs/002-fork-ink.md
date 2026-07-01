# ADR-002: Fork Ink for Custom Terminal Renderer

> Status: ACCEPTED  
> Date: 2026 (commit `8b59345`)  
> Confidence: 🟢 CONFIRMED

## Context

The original UI was built on `@opentui/core` and `@opentui/react`. As the project grew, limitations appeared:
- No full control over terminal rendering pipeline
- Missing low-level ANSI handling for advanced features
- Dependency on external library release cycle
- Need for custom layout, reconciliation, and event handling

## Decision

Replace `@opentui` dependencies with a **custom Ink-based renderer** — a local fork of Ink integrated directly into `src/ink/`.

## Rationale

1. Full control over rendering: layout engine, reconciliation, terminal I/O
2. Direct integration with yoga-layout for flex-based terminal layout
3. Custom ANSI parsing and terminal event handling
4. Ability to add features without waiting for upstream (ScrollBox, Button, etc.)
5. React Reconciler integration for component architecture

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Keep @opentui | Insufficient control, missing features needed for the TUI |
| Blessed/blessed-contrib | Not React-based, imperative API doesn't fit component model |
| Upstream Ink (npm) | Would still depend on external release cycle; needed deep customizations |
| Raw ANSI escape codes | Too low-level, would lose component composability |

## Consequences

- **Positive:** Complete control over rendering, layout, events
- **Positive:** Can implement custom components (ScrollBox, Button, etc.) without external PRs
- **Positive:** Tighter integration with the Agent feedback loop (streaming tokens, tool displays)
- **Negative:** Maintenance burden — must maintain terminal rendering code (~3k lines in `src/ink/`)
- **Negative:** Some Ink ecosystem packages may not be directly compatible
- **Technical debt:** TODOs in ink code reference upstream Ink issues (e.g., `TODO(vadimdemedes)`)
