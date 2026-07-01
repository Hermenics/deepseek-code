# Hooks Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Hooks module provides lifecycle hooks that execute shell commands at key points: before tool use, after tool use, and at session start.

## Functional Requirements

### FR-01: PreToolUse Hooks 🟢
- **Must** match hooks by tool name pattern (exact, `*`, or pipe-separated)
- **Must** send JSON to hook stdin (event, session_id, tool_name, tool_input)
- **Must** respect hook decisions: approve, block, or modify input
- **Must** chain multiple hooks (output of one feeds next)

### FR-02: PostToolUse Hooks 🟢
- **Must** fire after tool execution (fire-and-forget)
- **Must** include tool result in input (capped at 10,000 chars)
- **Must** not block on hook completion or errors

### FR-03: SessionStart Hooks 🟢
- **Must** fire during initialization after settings load
- **Must** not block session startup on hook failure

### FR-04: Security 🟢
- **Must** only load hooks from user-level settings (R05)
- **Must** timeout hooks at 30s (configurable per hook)
- **Must** handle hook process errors gracefully

## Non-Functional Requirements

### NFR-01: Reliability 🟢
- Hook failures never crash the agent
- Timeout prevents hanging hooks from blocking execution
