# Agent Module — Design

> Confidence: 🟢 CONFIRMED  
> Generated at: 2026-07-01

## Architecture

The Agent is implemented as a single TypeScript class (~1259 lines) in `src/agent/agent.ts`. It orchestrates all system behavior through a streaming conversation loop with tool calling.

## Class Structure

```
Agent
├── Properties
│   ├── client: OpenAI (SDK instance)
│   ├── messages: Message[] (conversation history)
│   ├── tools: Tool[] (built-in + MCP)
│   ├── toolMap: Map<string, Tool>
│   ├── openaiTools: ChatCompletionTool[]
│   ├── systemPrompt: string
│   ├── model: Model
│   ├── provider: ProviderName
│   ├── interactionMode: InteractionMode
│   ├── effortLevel: EffortLevel
│   ├── settings: DeepSeekSettings
│   ├── tokenCount / contextUsage / contextLimit
│   ├── sessionApprovedTools: Set<string>
│   ├── turnWriteCount: number
│   ├── compactState / autoCompactConfig
│   └── abortController: AbortController | null
├── Public Methods
│   ├── run(message, callbacks): Promise<void>
│   ├── abort(): void
│   ├── getPermissionsInfo(): object
│   └── setConfirmHandler / setToolPermissionHandler
└── Private Methods
    ├── initialize(): Promise<void>
    ├── runLoop(callbacks): Promise<void>
    ├── checkAndExecuteTool(tc, args, cb): Promise<{tc, result}>
    ├── sanitizeMessagesForApi(messages): Message[]
    ├── getEffortApiParams(): object
    ├── withRetry(fn): Promise<T>
    └── syncTurn(): void
```

## Key Algorithms

### runLoop — Main Conversation Loop
```
while iterations < 100:
  create AbortController
  sanitize messages for API
  if streaming:
    stream response, accumulating tokens and tool calls
  else:
    batch request (Bedrock R1 / Vertex)
  
  if no tool calls:
    save history, syncTurn, onDone, return
  
  partition tool calls: parallel-safe vs sequential
  if all parallel-safe and count > 1:
    Promise.allSettled(execute all)
  else:
    execute sequentially
  
  check auto-compact threshold → compact if needed
```

### checkAndExecuteTool — 5-Layer Pipeline
```
1. Auto mode? → skip to hooks
2. Mode check: canUseTool(mode, toolName)
3. Risk assessment (Build mode only):
   - assessRisk → if high, require confirmation
   - Session key = rule_id + content (content-scoped)
4. Permission rules (Plan mode only):
   - resolvePermission → deny/allow/ask
5. Pre-tool hooks → may block or modify input
6. Execute tool
7. Post-tool hooks (fire-and-forget)
8. Create file checkpoint if write tool
9. Audit log
```

### initialize — Parallel Bootstrap
```
Promise.all([
  loadSteering(),
  loadDeepSeekMd(),
  loadMergedSettings(),
  loadMcpTools()
])
→ merge into system prompt
→ apply settings overrides
→ inject Bedrock tool prompt if needed
→ run SessionStart hooks
```

## Data Flow

```
User Input → App.tsx → agent.run(message, callbacks)
                              │
                              ▼
                        runLoop (stream)
                              │
                    ┌─────────┴─────────┐
                    │                   │
              Tool Calls           Text Response
                    │                   │
                    ▼                   ▼
         checkAndExecuteTool      cb.onToken()
                    │                   │
                    ▼                   ▼
              Tool Result         saveHistory()
                    │
                    ▼
           Push to messages
           (loop continues)
```

## Error Handling

| Error | Handling |
|-------|----------|
| LLM API failure | `withRetry()` — exponential backoff |
| Tool execution error | Error message returned as tool result |
| User deny (permission) | `DenyAbortError` → terminates turn |
| User abort (Ctrl+C) | AbortController signal → graceful exit |
| Init failure | Catch, push to initErrors, continue with defaults |
| Compact failure | Increment consecutiveFailures, backoff |

## Concurrency Model

- Single Agent instance per session (no concurrent runs)
- Parallel tool execution within a turn (PARALLEL_SAFE set)
- Sequential tool execution for writes
- AbortController for cancellation propagation
- `Promise.allSettled` ensures all parallel tools get result recorded even if one is denied
