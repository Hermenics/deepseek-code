# Agent Module — Requirements

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Overview

The Agent module is the central orchestrator of DeepSeek Code. It manages the LLM conversation loop, tool execution pipeline, context compaction, and session lifecycle.

## Functional Requirements

### FR-01: Conversation Loop 🟢
- **Must** maintain a message history array (system + user + assistant + tool messages)
- **Must** stream LLM responses token-by-token when provider supports streaming
- **Must** support non-streaming fallback for Bedrock R1 and Vertex providers
- **Must** stop after 100 iterations to prevent infinite loops (R01)

### FR-02: Tool Execution Pipeline 🟢
- **Must** execute tool calls returned by the LLM through the 5-layer pipeline: mode check → risk assessment → permission rules → hooks → execute
- **Must** support parallel execution for tools in the PARALLEL_SAFE set (subagent, shell, grep, glob, read_file, read_folder, web_fetch, introspect)
- **Must** execute write tools (write_file, patch_file) sequentially
- **Must** track tool call count per turn for burst detection

### FR-03: Context Management 🟢
- **Must** trigger auto-compact when context usage reaches 85% of context limit (R03)
- **Must** perform micro-compact first (clear old tool results, keep last 5)
- **Must** fall back to full LLM summarization if micro-compact insufficient
- **Must** insert boundary markers at compaction points
- **Should** track consecutive compaction failures for backoff

### FR-04: Provider Abstraction 🟢
- **Must** support 4 providers: deepseek, bedrock, vertex, local
- **Must** create appropriate OpenAI SDK client per provider configuration
- **Must** handle Bedrock R1 prompt-based tool calling (XML format)
- **Must** handle Bedrock V3.x native tool calling via Chat Completions
- **Must** propagate provider config to SubAgents

### FR-05: Session Management 🟢
- **Must** generate unique session ID per instance
- **Must** save conversation history to disk after each completed turn
- **Must** support session checkpoints (save/restore, max 20)
- **Must** support file checkpoints for undo (before-state snapshots, max 10)

### FR-06: Initialization 🟢
- **Must** load in parallel: steering, DEEPSEEK.md, settings, MCP tools
- **Must** merge memory snapshot into system prompt
- **Must** run SessionStart hooks after initialization
- **Must** gracefully degrade if initialization fails (fall back to defaults)

### FR-07: Abort Handling 🟢
- **Must** support user abort (Ctrl+C) via AbortController
- **Must** stop streaming and return to idle on abort
- **Must** not corrupt message history on abort

### FR-08: Effort Level Control 🟢
- **Must** support 3 effort levels: low, high (default), max
- **Must** pass corresponding API parameters to the LLM provider
- **Should** allow runtime effort level changes via /effort command

### FR-09: Prompt Refinement 🟢
- **Should** optionally rewrite user messages for LLM effectiveness
- **Must** only trigger when enabled, message > 30 chars, not a command (R16)
- **Must** silently fall back to original message on error

### FR-10: Memory Sync 🟢
- **Should** sync memory after each completed turn
- **Must** guard against non-thenable return values from sync

## Non-Functional Requirements

### NFR-01: Performance 🟢
- Streaming first-token latency depends on provider (typically < 2s for DeepSeek API)
- Tool execution timeout: 30s for shell (configurable), no timeout for file ops
- Auto-compact buffer: 13,000 tokens reserved for compaction decision

### NFR-02: Security 🟢
- Auto mode bypass only via user action (never model-initiated)
- Content-scoped risk approvals (not blanket tool-level)
- DenyAbortError terminates entire turn on user denial
- Audit log records all tool invocations

### NFR-03: Reliability 🟢
- 100-iteration hard cap prevents runaway loops
- Graceful degradation on init failure
- History persistence after each turn prevents data loss
- Retry logic for transient LLM API errors

## Acceptance Criteria

### AC-01: Normal Turn Flow
```
Given a user message and an initialized Agent
When the agent processes the message
Then it streams tokens to the callback
And executes any tool calls through the permission pipeline
And saves history after completion
And fires onDone callback
```

### AC-02: Tool Execution Denied
```
Given a tool call that matches a deny rule
When checkAndExecuteTool is called
Then it returns the block message without executing the tool
And logs the denial to audit
```

### AC-03: Auto-Compact Triggers
```
Given context usage is 87% of context limit
When shouldAutoCompact is evaluated
Then it returns true
And micro-compact is attempted first
And full compact runs if micro-compact is insufficient
```

### AC-04: Iteration Limit
```
Given the agent has executed 100 iterations in runLoop
When the 101st iteration would start
Then the loop breaks with a warning message
And onDone is called
```

### AC-05: Abort Mid-Stream
```
Given the agent is streaming a response
When the user presses Ctrl+C
Then the AbortController signal fires
And streaming stops gracefully
And the agent returns to idle without corrupting state
```

## Dependencies

| Dependency | Direction | Description |
|-----------|-----------|-------------|
| Provider Layer | Outbound | LLM API calls |
| Tool Registry | Outbound | Tool execution |
| Permission Engine | Outbound | Mode/risk/permission checks |
| Hook System | Outbound | Pre/post tool lifecycle |
| Settings Manager | Inbound | Configuration loading |
| Compaction Service | Outbound | Context management |
| Memory Store | Bidirectional | Read at init, write after turns |
| TUI Layer | Inbound | Receives callbacks (onToken, onToolCall, etc.) |
