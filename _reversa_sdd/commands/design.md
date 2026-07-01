# Commands Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

Each command is a separate module in `src/commands/<name>/index.ts`. Commands are registered and dispatched via a router that matches the slash prefix.

## Structure

```
commands/
├── types.ts          — CommandResult type, EffortLevel, Model
├── index.ts          — command registry and dispatcher
├── help/             — /help
├── model/            — /model [name]
├── effort/           — /effort [low|high|max]
├── mode/             — /mode
├── clear/            — /clear
├── compact/          — /compact
├── undo/             — /undo
├── history/          — /history
├── checkpoint/       — /checkpoint [save|restore|list]
├── rc/               — /rc [start|stop|status|devices|unpair]
├── cost/             — /cost
└── ... (26 total)
```

## Command Result Type

```typescript
type CommandResult =
  | { type: 'message'; text: string }
  | { type: 'model'; model: Model }
  | { type: 'mode'; mode: InteractionMode }
  | { type: 'effort'; action: 'status' }
  | { type: 'effort'; action: 'set'; level: EffortLevel }
  | { type: 'clear' }
  | { type: 'compact' }
  | { type: 'undo' }
  | ... // other variants
```

## Data Flow

```
User types "/effort high"
  → InputBox detects "/" prefix
  → Command router parses "effort" + args ["high"]
  → effort/index.ts validates level
  → Returns { type: 'effort', action: 'set', level: 'high' }
  → App.tsx applies state change
```
