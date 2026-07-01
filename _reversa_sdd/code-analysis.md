# Code Analysis — deepseek-code

> Confidence: 🟢 CONFIRMED — extracted directly from source code.  
> Generated at: 2026-07-01  
> Doc level: detailed

## Module Summary

| Module | Path | Lines | Key Files | Complexity |
|--------|------|-------|-----------|------------|
| agent | `src/agent/` | 2,818 | agent.ts (1259), mcp.ts (164), fileCheckpoint.ts (147) | high |
| proxy | `src/agent/providers/proxy/` | 2,889 | orchestrator.ts (382), openai.ts (358), headers.ts (325) | high |
| tools | `src/tools/` | ~1,200 | SubAgent.ts (329), WebFetch.ts (159), pathSafety.ts (112) | medium |
| commands | `src/commands/` | ~800 | 26 slash commands, each in own folder | low |
| ink | `src/ink/` | ~3,500 | reconciler.ts, dom.ts, renderer.ts, event system | high |
| ui | `src/ui/` | ~2,500 | App.tsx (908), InputBox.tsx (353), MessageList.tsx (244) | medium |
| hooks | `src/hooks/` | ~180 | executor.ts (137), types.ts (35), matcher.ts (10) | low |
| permissions | `src/permissions/` | ~250 | risk.ts (130), matcher.ts (117) | medium |
| settings | `src/settings/` | ~130 | loader.ts (102), types.ts (26) | low |
| state | `src/state/` | ~100 | store.ts (65), selectors.ts | low |
| services | `src/services/` | ~200 | autoCompact.ts (81), mcp/client.ts, session/ | low |
| constants | `src/constants/` | ~50 | tools.ts, agent.ts, product.ts, ui.ts | trivial |
| utils | `src/utils/` | ~400 | fs.ts, credentials.ts, env.ts, sliceAnsi.ts | low |

---

## Module: agent (`src/agent/`)

### Core Class: `Agent` (1259 lines)

The heart of the system. Manages the entire agent loop: user input → LLM call → tool execution → response.

#### Key Properties

| Property | Type | Purpose |
|----------|------|---------|
| `client` | OpenAI | LLM API client |
| `messages` | MessageOrBoundary[] | Full conversation history with compact boundaries |
| `tools` | Tool[] | Available tools (built-in + MCP) |
| `toolMap` | Map<string, Tool> | Fast tool lookup by name |
| `model` | Model | Active model name |
| `provider` | ProviderConfig['provider'] | Active provider (deepseek/bedrock/vertex/local) |
| `interactionMode` | InteractionMode | plan/build/auto |
| `effortLevel` | EffortLevel | low/high/max |
| `tokenUsage` | TokenUsage | Prompt/completion/cached token counts |
| `undoStack` | UndoEntry[] | File content before writes (max 10) |
| `compactState` | CompactState | Circuit breaker for auto-compact |
| `sessionApprovedTools` | Set<string> | Tools user approved for this session |

#### Key Methods

| Method | Params | Returns | Purpose |
|--------|--------|---------|---------|
| `run()` | userMessage, callbacks | void | Main entry: refine prompt → inject notes → start loop |
| `runLoop()` | callbacks | void | Core agent loop (max 100 iterations) |
| `checkAndExecuteTool()` | tc, args, cb | {tc, result} | Unified pipeline: mode → risk → permission → hooks → execute |
| `compact()` | — | string (summary) | Summarize conversation via LLM and reset history |
| `initialize()` | — | void | Async init: load steering, MCP, settings, run hooks |
| `setModel()` | model | void | Switch model + update context limit |
| `setEffortLevel()` | level | void | Inject effort hint into system prompt |
| `saveCheckpoint()` | label? | string (id) | Persist conversation state to disk |

#### Agent Loop Algorithm (streaming path)

```
1. Reset abort controller
2. Get active messages (after last compact boundary)
3. Call LLM with streaming (stream_options: include_usage)
4. Accumulate tokens:
   - reasoning_content → cb.onThinking()
   - content → cb.onToken()
   - tool_calls → buffer by index
5. If no tool calls → save history, syncTurn (auto-learn), done
6. If tool calls:
   a. Parse all arguments
   b. Partition: parallel-safe vs sequential
   c. Execute (parallel via Promise.allSettled or sequential)
   d. Append tool results to messages
   e. Continue loop (next iteration)
7. Mid-turn auto-compact if context > 85%
```

#### Permission Pipeline (`checkAndExecuteTool`)

```
0. Auto mode → bypass ALL checks
1. Mode restriction (plan mode blocks writes)
2. Risk assessment (Build mode: destructive patterns, write bursts)
3. Permission rules (deny/allow/ask from settings)
4. Legacy allowedTools (agent-config whitelist)
5. PreToolUse hooks (may block or modify args)
6. Undo snapshot (file content before write)
7. Execute tool
8. PostToolUse hooks (fire-and-forget)
```

### llmClient.ts — Factory Pattern

Creates OpenAI-compatible clients per provider:
- `deepseek` → api.deepseek.com (native)
- `bedrock` → Custom fetch with SigV4 signing (R1: InvokeModel, V3.x: bedrock-mantle)
- `vertex` → Custom fetch with Google OAuth
- `local` → Any OpenAI-compatible endpoint

### cost.ts — Token Pricing

| Model | Input $/M | Cached $/M | Output $/M |
|-------|-----------|------------|------------|
| deepseek-chat | 0.27 | 0.07 | 1.10 |
| deepseek-reasoner | 0.55 | 0.14 | 2.19 |
| deepseek-v4-flash | 0.27 | 0.07 | 1.10 |
| deepseek-v4-pro | 0.55 | 0.14 | 2.19 |

Context limit: 128k for all models/providers.

### memory.ts — Simple Flat-File Memory

- Two files: `MEMORY.md` (agent), `USER.md` (user preferences)
- Delimiter: `\n§\n`
- Max 2000 chars total per file
- Operations: add, replace (by substring match), remove, snapshot

### promptRefiner.ts — Automatic Prompt Enhancement

- Triggers on messages ≥ 30 chars, not starting with `/`
- Sends to same model with a "Prompt Engineer" system prompt
- Returns `SKIP` if refinement not useful
- Silent fallback on any error

### fileCheckpoint.ts — Granular File Rollback

- Per-session manifest (`~/.deepseek-code/checkpoints/<sessionId>/manifest.json`)
- Backs up file content before each write/patch
- Supports rollbackLast, rollbackAll, list

### compactBoundary.ts — Conversation Windowing

- `CompactBoundaryMarker` separates compacted history from active context
- `getMessagesAfterBoundary()` returns only the active window + system prompt
- Enables multiple compaction cycles without losing system prompt

### steering.ts — Project Context Loading

- Loads `.deepseek/steering/*.md` files (custom instructions)
- Loads `DEEPSEEK.md` from project root and/or `.deepseek/` directory
- Both injected into system prompt at initialization

### session.ts — Session Persistence

- Stored in `~/.deepseek/sessions/<id>.json`
- Max 50 sessions (FIFO pruning)
- Saves: messages, UI state, model, provider, language, files modified

### syncTurn — Auto-Learning

- After each completed turn, fires a background LLM call
- Extracts 0-1 new facts about user/project
- Adds to agent memory (fire-and-forget, never blocks)

---

## Module: proxy (`src/agent/providers/proxy/`)

### Architecture

Full HTTP proxy server built with Hono that:
1. Accepts OpenAI-compatible and Anthropic-compatible requests
2. Translates them to DeepSeek's native browser-based API
3. Streams responses back in the requested format

### Components

| Layer | Files | Purpose |
|-------|-------|---------|
| Server | `index.ts`, `start.ts`, `config.ts` | Hono app setup, lifecycle |
| Middleware | `auth.ts`, `cors.ts`, `rate-limit.ts`, `error-handler.ts`, `request-logger.ts` | Request pipeline |
| Routes | `openai.ts`, `anthropic.ts` | API format adapters |
| Services | `orchestrator.ts`, `deepseek-api.ts`, `cache.ts`, `history.ts`, `output-sanitizer.ts` | Core logic |
| Browser | `playwright.ts`, `pool.ts`, `headers.ts`, `observer.ts`, `sessionParent.ts` | Chromium page pool |
| Tools | `prompt-emulation.ts`, `schema.ts`, `registry.ts`, `executor.ts` | Tool calling via prompt injection |

### Key Algorithm: `orchestrate()` (382 lines)

```
1. Filter messages
2. Build prompt (system + conversation + tools via prompt injection)
3. Force parent_message_id: null (stateless per request)
4. Create DeepSeek stream via browser pool
5. Parse SSE chunks:
   - Handle thinking tokens vs content tokens
   - Hold back trailing buffer (150 chars) for tool call detection
   - Sanitize output (remove markers)
6. Retry up to 3 times on network errors
7. Abort on permanent auth errors (OAuth expired, WAF)
```

### Tool Calling Strategy

DeepSeek doesn't support native function calling in browser mode. The proxy uses **prompt emulation**:
- Injects tool definitions into the system prompt
- Instructs the model to output `{"tool_use": {"name": ..., "arguments": ...}}`
- Parses JSON from model output to detect tool calls
- Executes tools and feeds results back

---

## Module: tools (`src/tools/`)

### Tool Interface

```typescript
interface Tool {
  name: string
  description: string
  parameters: object  // JSON Schema
  execute(args: Record<string, unknown>): Promise<string>
}
```

### Tool Registry (15 tools)

| Tool | File | Lines | Key Feature |
|------|------|-------|-------------|
| WriteFile | WriteFile.ts | 78 | Creates/overwrites files |
| PatchFile | PatchFile.ts | 88 | LCS-based diff patching |
| ReadFile | ReadFile.ts | — | File reading with line range |
| ReadFolder | ReadFolder.ts | — | Directory listing |
| Grep | Grep.ts | — | Regex search (max 200 lines) |
| Glob | Glob.ts | — | File pattern matching (max 500) |
| Shell | Shell.ts | 66 | Command execution with destructive detection |
| Introspect | Introspect.ts | — | Agent self-inspection |
| WebFetch | WebFetch.ts | 159 | URL fetching with SSRF protection |
| SubAgent | SubAgent.ts | 329 | Spawn child agents with role-based permissions |
| UpdateKnowledge | UpdateKnowledge.ts | — | Updates memory/knowledge base |
| Todo | Todo.ts | — | Task list management |
| Git | Git.ts | — | Git operations |
| Memory | MemoryTool.ts | 63 | Read/write agent memory |
| MoA | MoA.ts | 57 | Mixture of Agents (multi-model synthesis) |

### Security: pathSafety.ts

- **Path sandbox**: Files must be within `process.cwd()`
- **Symlink traversal protection**: Resolves real path before access
- **Blocked directories**: `.agent`, `.claude`, `.kiro`, `.github`, `.deepseek`, `node_modules`, `dist`, `build`, `.git`
- **Sensitive files blocked**: `.env*`, `*.pem`, `*.key`, credentials, SSH keys, service accounts

### Shell: Destructive Command Detection

Patterns that trigger confirmation:
- `rm -rf`, `git reset --hard`, `git push --force`
- `drop table`, `truncate table`, `mkfs`, `dd`, `chmod -R 777`, `sudo rm`

### SubAgent: Role-Based Spawning

- Roles: researcher, coder, reviewer (auto-inferred from task)
- Each role has different tool access
- Contracts: structured output format (SubAgentResult)
- Memory: cross-agent task memory (per user turn)
- Verification: optional result verification via second LLM call
- Max iterations: 15

### MoA (Mixture of Agents)

- Sends same prompt to multiple reference models in parallel
- Aggregator model synthesizes the diverse responses
- Configurable reference models and temperatures

---

## Module: hooks (`src/hooks/`)

### Architecture

Shell-command-based hook system with three event types:

| Event | Timing | Can Block? | Can Modify? |
|-------|--------|-----------|-------------|
| PreToolUse | Before tool execution | Yes | Yes (modified_input) |
| PostToolUse | After tool execution | No | No |
| SessionStart | On agent initialization | No | No |

### Execution Flow (PreToolUse)

```
1. Check config.PreToolUse matchers
2. For each matching hook:
   a. Spawn shell process
   b. Send JSON to stdin: {event, session_id, tool_name, tool_input}
   c. Read stdout (JSON): {decision: approve|block, reason?, modified_input?}
3. If any returns "block": stop execution, return reason
4. If modified_input: pass to next hook and ultimately to tool
```

### Pattern Matching

- `*` → matches all tools
- `Shell` → exact match
- `Shell|WriteFile` → pipe-separated list (case-insensitive)

---

## Module: permissions (`src/permissions/`)

### Two-Layer System

1. **Permission Rules** (`matcher.ts`): Allow/deny patterns from settings
2. **Risk Assessment** (`risk.ts`): Heuristic-based risk scoring

### Permission Resolution Order

```
1. Check deny rules → if match: DENY
2. Check allow rules → if match: ALLOW
3. Fallback:
   - If allow rules exist but none matched → ASK
   - If only deny rules exist and none matched → ALLOW
```

### Glob Matching (Anti-ReDoS)

- Iterative algorithm (no regex backtracking)
- Max 10 wildcards per pattern
- Case-insensitive comparison
- Supports `*` (any chars) and `?` (single char)

### Risk Rules (46 default rules)

Two levels:
- **HIGH** (always require confirmation): destructive shell, sudo, deploy, build, config writes
- **MEDIUM** (require confirmation only in subagent): git push/commit, config files, write bursts

Special conditions:
- `large_overwrite`: file has ≥100 existing lines
- `multi_edit_burst`: ≥3 writes in current turn

---

## Module: settings (`src/settings/`)

### Three-Level Merge

```
user (~/.deepseek/settings.json)
  ↓ merged with
project (.deepseek/settings.json)
  ↓ merged with
local (.deepseek/settings.local.json)
```

### Security Measure

**Hooks are stripped from project and local level** — only user-level settings can define hooks. This prevents malicious repos from executing arbitrary commands.

### Merge Strategy

- Arrays: concat + dedup
- Objects: deep merge (one level)
- Scalars: higher priority wins (local > project > user)

---

## Module: state (`src/state/`)

### Minimal Store Pattern

Simple pub/sub state management:
- `getState()` → read-only snapshot
- `setState(partial)` → shallow merge + notify listeners
- `subscribe(listener)` → returns unsubscribe function

No external libraries. ~65 lines total.

---

## Module: services (`src/services/`)

### Auto-Compact (context management)

- Triggers when context usage > 85% of limit
- Circuit breaker: disables after 3 consecutive failures
- MicroCompact: truncates old tool results (keeps last 5 intact)
- Summary generated by LLM using specialized compact prompts

### MCP Client

- Re-exported from `@modelcontextprotocol/sdk`
- Configuration via `.deepseek/mcp.json`
- Security: blocks critical env vars, validates commands for injection

---

## Module: interactionMode (`src/ui/interactionMode.ts`)

### Three Modes

| Mode | Write Tools | Confirmation | Description |
|------|------------|-------------|-------------|
| plan | No | — | Read-only exploration |
| build | Yes | Risk-based | Default. Writes with safety checks |
| auto | Yes | None | Zero restrictions. User-only activation |

Cycle: plan → build → auto → plan (via Shift+Tab or `/plan` command)

---

## Cross-Cutting Concerns

### Audit Log (`agent/auditLog.ts`)

- JSONL file per session: `~/.deepseek/logs/session-<id>.jsonl`
- Events: session_start, tool_call, tool_result, compact, checkpoint, mcp_server_load, session_end
- Never crashes the agent on failure

### Error Handling

- `DenyAbortError`: Special error class for user denial → graceful abort
- `withRetry()`: Exponential backoff (1s, 2s, 4s) on 429/503
- Never retries aborted requests

### Token Management

- Tracks prompt, completion, and cached tokens separately
- Context limit: 128k for all models
- Auto-compact at 85% usage
- MicroCompact clears old tool results

---

## Business Rules (🟢 CONFIRMED)

1. **Max agent iterations**: 100 per user turn
2. **Undo stack**: max 10 entries
3. **Checkpoint limit**: max 20 on disk
4. **Session limit**: max 50 stored
5. **Input history**: max 200 entries, excludes `/` and `!` prefixes
6. **Shell timeout**: 30s default
7. **Shell output**: max 50k chars
8. **Grep**: max 200 lines
9. **Glob**: max 500 files
10. **SubAgent**: max 15 iterations
11. **Memory**: max 2000 chars per file
12. **MCP tool timeout**: 30s
13. **Auto-compact threshold**: 85% context usage
14. **MicroCompact**: keeps last 5 tool results
15. **Prompt refiner**: min 30 chars to trigger
16. **Risk detection**: confirmation required for HIGH rules always, MEDIUM only in subagent context
17. **Hooks only from user settings**: project/local hooks stripped for security
18. **Critical env vars blocked**: PATH, HOME, LD_PRELOAD, NODE_OPTIONS, etc.
19. **Parallel-safe tools**: subagent, shell, grep, glob, read_file, read_folder, web_fetch, introspect
20. **Effort levels**: low (disable thinking), high (default), max (deep reasoning)
