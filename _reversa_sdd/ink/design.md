# Ink Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

A custom Ink fork located in `src/ink/` providing the complete terminal rendering pipeline.

## Structure

```
ink/
├── ink.tsx               — Main Ink instance (render, rerender, cleanup)
├── dom.ts               — Virtual DOM node implementation
├── reconciler.ts        — React Reconciler host config
├── render-to-screen.ts  — Convert virtual DOM to terminal output
├── screen.ts            — Screen buffer, cell management, diff rendering
├── terminal.ts          — Terminal state machine (raw mode, cursor, etc.)
├── layout/
│   └── node.ts          — Yoga layout node wrapper
├── components/
│   ├── App.tsx           — Root app wrapper
│   ├── Box.tsx           — Flexbox container
│   ├── Text.tsx          — Styled text
│   ├── ScrollBox.tsx     — Scrollable container
│   ├── Button.tsx        — Interactive button
│   ├── StdinContext.ts   — Stdin provider
│   ├── ClockContext.tsx  — Clock/timer context
│   └── TerminalFocusContext.tsx — Focus management
├── hooks/
│   └── use-tab-status.ts — Tab focus hook
├── events/
│   ├── input-event.ts    — Keystroke parsing
│   └── terminal-event.ts — Terminal state events
└── termio/
    ├── csi.ts            — CSI escape sequences
    └── dec.ts            — DEC private modes
```

## Rendering Pipeline

```
React Component Tree
  → Reconciler creates/updates virtual DOM nodes
  → Yoga layout calculates positions/dimensions
  → render-to-screen converts to cell grid
  → screen.ts diffs against previous frame
  → Only changed cells written to stdout
```

## Key Patterns

- **Yoga integration:** Each Box maps to a Yoga node for flexbox layout
- **Cell-based rendering:** Terminal treated as a grid of cells (character + style)
- **Diff rendering:** Only cells that changed since last frame are written
- **Focus system:** Tab navigation between focusable components
