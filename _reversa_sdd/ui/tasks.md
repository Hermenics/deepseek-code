# UI Module — Tasks

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Tasks for Reimplementation

### T-01: Implement App Root Component
- **Source:** `src/ui/App.tsx`
- **Description:** Root component with state management, Agent instantiation, mode cycling, callback wiring, setup flow detection.
- **Done when:** App renders REPL or Setup based on state, mode cycles via Shift+Tab, Agent callbacks update UI.
- **Confidence:** 🟢

### T-02: Implement InputBox
- **Source:** `src/ui/input/InputBox.tsx`, `src/ui/input/hooks/`
- **Description:** Text input with cursor, vim mode, history navigation, ghost suggestions, command detection, submit/abort handling.
- **Done when:** Text entry works, Tab shows ghost, Up/Down navigate history, Ctrl+C aborts, Enter submits.
- **Confidence:** 🟢

### T-03: Implement MessageList and ToolUseDisplay
- **Source:** `src/ui/messages/MessageList.tsx`, `src/ui/messages/ToolUseDisplay.tsx`
- **Description:** Render conversation. Markdown highlighting. Tool call expand/collapse. DiffView for file writes.
- **Done when:** Messages display with correct formatting, tool calls are expandable.
- **Confidence:** 🟢

### T-04: Implement SubagentList
- **Source:** `src/ui/subagent/`
- **Description:** Hook to track subagents. Color assignment. Progress lines with spinner/status/cost.
- **Done when:** Running agents show spinner, completed show result, colors are unique.
- **Confidence:** 🟢

### T-05: Implement StatusBar
- **Source:** `src/ui/layout/StatusBar.tsx`
- **Description:** Mode badge (colored), model name, token count, context %, cost display.
- **Done when:** All fields render and update in real-time during processing.
- **Confidence:** 🟢

### T-06: Implement Theme System
- **Source:** `src/ui/theme.ts`
- **Description:** 6 theme definitions with color palettes for all UI elements.
- **Done when:** Themes switch correctly, daltonized versions accessible.
- **Confidence:** 🟢

### T-07: Implement Interaction Mode Logic
- **Source:** `src/ui/interactionMode.ts`
- **Description:** Mode types, TOOL_PERMISSIONS matrix, cycling, canUseTool, canModelActivateMode, destructive patterns.
- **Done when:** Mode cycling works, tool filtering correct per mode, model can't activate auto.
- **Confidence:** 🟢
