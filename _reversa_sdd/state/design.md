# State Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

A simple singleton store in `src/state/store.ts` with pub/sub pattern.

## Structure

```
state/
├── store.ts       — getState, setState, subscribe, resetState
└── selectors.ts   — derived state helpers
```

## Implementation

```typescript
let state: AppState = { /* defaults */ }
const listeners: Set<Listener> = new Set()

function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial }
  listeners.forEach(fn => fn(state))
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
```

## Usage

- Agent updates state after each API call (tokens, context usage)
- UI components subscribe for re-render triggers
- AppContext bridges store to React tree
