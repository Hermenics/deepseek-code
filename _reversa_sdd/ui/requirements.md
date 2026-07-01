# UI Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The UI module provides the React component layer that renders the terminal user interface — input handling, message display, tool call visualization, subagent progress, and status bar.

## Functional Requirements

### FR-01: App Shell 🟢
- **Must** bootstrap Ink renderer with App root component
- **Must** manage interaction mode state (plan/build/auto)
- **Must** wire Agent callbacks to UI state updates
- **Must** handle first-run setup flow (API key, model, theme)

### FR-02: Input Handling 🟢
- **Must** provide InputBox with text input, cursor, and submit
- **Must** support vim mode (via useVimMode hook)
- **Must** support input history navigation (Up/Down)
- **Must** support command autocomplete with ghost text (Tab)
- **Must** cycle interaction modes (Shift+Tab)
- **Must** handle Ctrl+C (abort or quit)

### FR-03: Message Rendering 🟢
- **Must** render conversation messages with markdown syntax highlighting
- **Must** display assistant thinking/reasoning in a separate panel
- **Must** display tool calls with expand/collapse
- **Must** render file diffs with DiffView component
- **Must** show auto-compact notifications

### FR-04: SubAgent Display 🟢
- **Must** show running subagents with spinner, task, tool info
- **Must** assign unique color per subagent
- **Must** display result summary and cost on completion
- **Must** show role and verification status

### FR-05: Status Bar 🟢
- **Must** display: mode badge (colored), model name, token count, context %, cost
- **Must** update in real-time during agent processing

### FR-06: Theme System 🟢
- **Must** support 6 themes: dark, light, dark-daltonized, light-daltonized, dark-ansi, light-ansi
- **Must** apply theme colors consistently across all components

## Non-Functional Requirements

### NFR-01: Responsiveness 🟢
- Streaming tokens render immediately (no buffering)
- Input responsive during agent processing (abort via Ctrl+C)
