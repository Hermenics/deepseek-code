# UI Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

The UI layer is composed of React components rendered via the custom Ink fork. App.tsx is the root, managing global state and wiring Agent callbacks.

## Structure

```
ui/
├── App.tsx                — Root component, state, mode cycling, callbacks
├── interactionMode.ts     — Mode types, tool matrix, cycling logic
├── theme.ts               — Theme definitions and color palettes
├── clock.ts               — Clock/timer utilities
├── input/
│   ├── InputBox.tsx       — Main input component
│   ├── hooks/
│   │   ├── index.ts       — useTextInput, useVimMode, useInputHistory
│   │   └── ...
│   ├── ghost/
│   │   └── argumentHints.ts — Ghost text suggestions
│   └── render/
│       └── InputChrome.tsx — Input visual wrapper (mode badge, prompt)
├── messages/
│   ├── MessageList.tsx    — Conversation rendering
│   ├── ToolUseDisplay.tsx — Tool call expand/collapse
│   ├── toolDisplay.ts     — Tool result formatting
│   └── TodoPanel.tsx      — TODO list panel
├── subagent/
│   ├── useSubagents.ts    — SubAgent state management hook
│   ├── types.ts           — SubagentState, SubagentStatus
│   └── SubagentLine.tsx   — Per-agent progress line
├── layout/
│   └── StatusBar.tsx      — Bottom status bar
└── setup/
    ├── ModelSelector.tsx  — Model selection screen
    └── ThemeSelector.tsx  — Theme selection screen
```

## Component Hierarchy

```
<App>
  ├── <WelcomeScreen> (first load only)
  ├── <Setup> (if first run: API key, model, theme)
  └── <REPL>
      ├── <MessageList>
      │   ├── <MarkdownText> (per message)
      │   ├── <ToolUseDisplay> (per tool call)
      │   └── <TodoPanel> (if todos exist)
      ├── <SubagentList>
      │   └── <SubagentLine> (per active subagent)
      ├── <InputBox>
      │   └── <InputChrome> (mode badge + prompt)
      └── <StatusBar>
```

## State Management

- App.tsx uses useState for: interactionMode, messages, isProcessing, subagents
- Agent callbacks (onToken, onToolCall, onDone) update local state
- AppContext provides state + dispatch to children
- Global AppState store (src/state/store.ts) for cross-component access
