# Commands Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Commands module handles 26 slash-prefixed commands (e.g., `/help`, `/model`, `/effort`) that are processed directly by the CLI without being sent to the LLM.

## Functional Requirements

### FR-01: Command Routing 🟢
- **Must** detect input starting with `/` and route to command handler
- **Must** support 26 built-in commands
- **Must** return structured CommandResult for UI rendering

### FR-02: Core Commands 🟢
- `/help` — display available commands
- `/model` — switch LLM model
- `/effort` — change reasoning effort (low/high/max)
- `/mode` — display/change interaction mode
- `/clear` — clear conversation history
- `/compact` — force context compaction
- `/undo` — rollback last file modification
- `/history` — show/manage conversation history
- `/checkpoint` — save/restore session state
- `/rc` — remote control (start/stop/status/devices/unpair)
- `/cost` — display token usage and cost estimate

### FR-03: Command Autocomplete 🟢
- **Should** provide ghost text suggestions for commands via Tab
- **Should** support fuzzy matching for command names

## Non-Functional Requirements

### NFR-01: Responsiveness 🟢
- Commands execute synchronously (no LLM call)
- Instant feedback to user
