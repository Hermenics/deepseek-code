# Data Dictionary — deepseek-code

> Confidence: 🟢 CONFIRMED — extracted directly from source code.  
> Generated at: 2026-07-01

## Core Types

### Agent Types (`src/agent/`)

#### TokenUsage
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| promptTokens | number | yes | Total prompt tokens consumed |
| completionTokens | number | yes | Total completion tokens generated |
| cachedTokens | number | yes | Tokens served from cache |

#### AgentCallbacks
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| onToken | (text: string) => void | yes | Called on each content token |
| onThinking | (text: string) => void | no | Called on reasoning tokens |
| onToolCall | (name: string, args: object) => void | yes | Called when tool is invoked |
| onToolResult | (name: string, result: string, args: Record) => void | yes | Called when tool returns |
| onDone | () => void | yes | Called when turn completes |
| onPhaseChange | (phase: 'refining' \| 'executing') => void | no | Prompt refinement phase |
| onAutoCompact | (summary: string) => void | no | Context auto-compaction event |
| onDenyAbort | () => void | no | User denied a tool call |

#### UndoEntry
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | yes | File path that was modified |
| content | string | yes | Original content before modification |

#### CompactBoundaryMarker
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | `'__compact_boundary__'` | yes | Sentinel marker separating compacted history |

#### MessageOrBoundary
Union type: `ChatCompletionMessageParam | CompactBoundaryMarker`

---

### Provider Types (`src/types/provider.ts`)

#### ProviderConfig
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| provider | 'deepseek' \| 'bedrock' \| 'vertex' \| 'local' | yes | Active LLM provider |
| apiKey | string | no | DeepSeek API key |
| baseURL | string | no | DeepSeek base URL override |
| awsRegion | string | no | AWS region for Bedrock |
| awsProfile | string | no | AWS profile for Bedrock |
| gcpProject | string | no | GCP project for Vertex |
| gcpLocation | string | no | GCP location for Vertex |
| gcpCredentials | string | no | Path to GCP service account JSON |
| localBaseUrl | string | no | Local endpoint URL |
| localModel | string | no | Local model name |

---

### Agent Config (`src/agent/config.ts`)

#### AgentConfig
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Agent identifier |
| model | Model | no | Model override for this agent |
| systemPrompt | string | yes | Custom system prompt |
| files | string[] | no | Context files to inject |
| allowedTools | string[] \| '*' | no | Tool permission whitelist |

---

### Session Types (`src/agent/session.ts`)

#### SessionData
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Hex session identifier (12 chars) |
| title | string | no | AI-generated display title for the conversation |
| createdAt | string (ISO) | yes | Session creation timestamp |
| updatedAt | string (ISO) | yes | Last update timestamp |
| cwd | string | yes | Working directory |
| model | string | yes | Active model name |
| provider | string | yes | Active provider |
| language | string \| null | yes | Preferred response language |
| activeAgent | string \| null | yes | Custom agent name if active |
| agentMessages | MessageOrBoundary[] | yes | Full agent conversation history |
| uiMessages | Message[] | yes | UI-level message history |
| filesModified | string[] | yes | Files touched in session |

---

### Checkpoint Types (`src/agent/checkpoint.ts`)

#### Checkpoint
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | `<timestamp>-<hex>` identifier |
| timestamp | string (ISO) | yes | Creation time |
| label | string | yes | Human-readable label |
| messages | MessageOrBoundary[] | yes | Full conversation state |
| filesModified | string[] | yes | Files tracked at checkpoint time |

#### FileCheckpointEntry
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | `<timestamp>-<hex>` identifier |
| timestamp | number | yes | Unix ms timestamp |
| path | string | yes | Absolute file path |
| backupFile | string | yes | SHA-256 hash-based backup filename |
| toolName | string | yes | Tool that triggered the write |

---

### Tools Types (`src/tools/types.ts`)

#### Tool
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Unique tool identifier |
| description | string | yes | Human-readable description |
| parameters | object | yes | JSON Schema for arguments |
| execute | (args) => Promise<string> | yes | Execution function |

---

### Permission Types (`src/permissions/types.ts`)

#### PermissionRule
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| raw | string | yes | Original rule string |
| toolName | string | yes | Parsed tool name (lowercase) |
| pattern | string \| undefined | no | Glob pattern to match against |

#### PermissionDecision
Enum: `'allow' | 'deny' | 'ask'`

#### RiskRule
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique rule identifier |
| level | 'high' \| 'medium' | yes | Risk severity |
| tool | string | no | Tool this rule applies to |
| pattern | string | no | Glob pattern for command/path |
| condition | string | no | Special condition ('large_overwrite' \| 'multi_edit_burst') |
| description | string | no | Human-readable explanation |

#### RiskAssessment
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| level | 'high' \| 'medium' | yes | Assessed risk level |
| matchedRule | string | yes | Rule ID that triggered |
| description | string | yes | Why this was flagged |
| requiresConfirmation | boolean | yes | Whether user must approve |

#### RiskContext
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| isSubAgent | boolean | yes | Whether caller is a subagent |
| recentWriteCount | number | yes | Writes in current turn |
| config | RiskConfig | yes | User risk configuration |

---

### Hook Types (`src/hooks/types.ts`)

#### HookCommand
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | 'command' | yes | Always 'command' |
| command | string | yes | Shell command to execute |
| timeout | number | no | Seconds (default 30) |

#### HookMatcher
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| matcher | string | yes | Tool pattern: '*', exact, or pipe-separated |
| hooks | HookCommand[] | yes | Commands to run |

#### HooksConfig
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| PreToolUse | HookMatcher[] | no | Before tool execution |
| PostToolUse | HookMatcher[] | no | After tool execution |
| SessionStart | HookCommand[] | no | On agent init |

#### HookInput (JSON sent to stdin)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| event | HookEvent | yes | 'PreToolUse' \| 'PostToolUse' \| 'SessionStart' |
| session_id | string | yes | Current session UUID |
| tool_name | string | no | Tool being invoked |
| tool_input | Record | no | Tool arguments |
| tool_result | string | no | Tool output (PostToolUse only, max 10k) |

#### PreToolHookOutput (expected stdout)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| decision | 'approve' \| 'block' | no | Whether to proceed |
| reason | string | no | Block reason (shown to agent) |
| modified_input | Record | no | Modified tool arguments |

---

### Settings Types (`src/settings/types.ts`)

#### DeepSeekSettings
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| permissions | PermissionsConfig | no | Allow/deny rules |
| hooks | HooksConfig | no | Hook definitions (user level only) |
| model | string | no | Default model override |
| theme | string | no | UI theme |
| language | string | no | Preferred language |
| autoCompact | boolean | no | Enable auto-compaction (default true) |
| autoCompactThreshold | number | no | 0.0-1.0 trigger threshold |
| promptRefiner | { enabled?, model? } | no | Prompt refinement config |
| risk | RiskConfig | no | Risk assessment overrides |

#### SettingsLevel
Enum: `'user' | 'project' | 'local'`

---

### State Types (`src/state/store.ts`)

#### AppState
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionId | string | yes | Current session ID |
| provider | string | yes | Active provider |
| model | string | yes | Active model |
| tokenCount | number | yes | Total tokens used |
| contextUsage | number | yes | Current prompt token count |
| contextLimit | number | yes | Max context window |
| activeAgent | string \| null | yes | Custom agent name |
| isProcessing | boolean | yes | Whether agent is running |

---

### UI Types

#### InteractionMode
Enum: `'plan' | 'build' | 'auto'`

#### EffortLevel
Enum: `'low' | 'high' | 'max'`

#### ToolPermissionResult
Enum: `'once' | 'session' | 'always' | 'deny'`

---

### Audit Types (`src/agent/auditLog.ts`)

#### AuditEvent (discriminated union)
| Type | Fields | Description |
|------|--------|-------------|
| session_start | model, provider, cwd | Session began |
| tool_call | tool, args | Tool invoked |
| tool_result | tool, result, durationMs | Tool completed |
| compact | reason | Context compacted |
| compact_error | reason | Compaction failed |
| checkpoint | id, label? | Checkpoint saved |
| session_end | totalTokens | Session ended |
| mcp_server_load | serverName, transport | MCP server connected |

---

### Proxy Types (`src/agent/providers/proxy/types/`)

#### ProxyRequest
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| model | string | yes | Requested model |
| messages | ChatMessage[] | yes | Conversation messages |
| tools | ToolDef[] | no | Tool definitions |

#### TokenEvent (streaming output)
| Field | Type | Description |
|-------|------|-------------|
| type | 'content' \| 'thinking' \| 'done' \| 'error' \| 'usage' | Event type |
| text | string | Token content |

#### MCP Config (`.deepseek/mcp.json`)
```json
{
  "servers": {
    "<name>": {
      "transport": "stdio" | "http",
      "command": "...",      // stdio only
      "args": ["..."],       // stdio only
      "env": {},             // stdio only
      "url": "..."           // http only
    }
  }
}
```

---

## Constants

| Constant | Value | Source |
|----------|-------|--------|
| SHELL_OUTPUT_MAX_CHARS | 50,000 | constants/tools.ts |
| SHELL_TIMEOUT_MS | 30,000 | constants/tools.ts |
| GREP_MAX_LINES | 200 | constants/tools.ts |
| GLOB_MAX_FILES | 500 | constants/tools.ts |
| SUBAGENT_MAX_ITERATIONS | 15 | constants/tools.ts |
| UNDO_STACK_MAX | 10 | constants/agent.ts |
| CONTEXT_COMPACT_THRESHOLD | 0.85 | constants/agent.ts |
| AUTO_COMPACT_BUFFER_TOKENS | 13,000 | constants/agent.ts |
| MICRO_COMPACT_KEEP_LAST | 5 | constants/agent.ts |
| CHECKPOINT_MAX | 20 | constants/agent.ts |
| REFINER_MAX_TOKENS | 1,024 | constants/agent.ts |
| REFINER_MIN_LENGTH | 30 | constants/agent.ts |
| DIFF_MAX_LINES | 50 | constants/ui.ts |
| MAX_SESSIONS | 50 | agent/session.ts |
| MAX_ENTRIES (input history) | 200 | agent/inputHistory.ts |
| MEMORY MAX_CHARS | 2,000 | agent/memory.ts |
| MCP_TIMEOUT | 30,000 | agent/mcp.ts |
| MAX_AGENT_ITERATIONS | 100 | agent/agent.ts |

---

## File Persistence Map

| Data | Location | Format |
|------|----------|--------|
| Sessions | `~/.deepseek/sessions/<project>-<cwd-hash>/<id>.json` (legacy root/project folders readable) | JSON |
| Checkpoints | `~/.deepseek/checkpoints/<id>.json` | JSON |
| File checkpoints | `~/.deepseek-code/checkpoints/<session>/` | JSON manifest + file backups |
| Audit log | `~/.deepseek/logs/session-<id>.jsonl` | JSONL |
| Input history | `~/.deepseek/input_history.json` | JSON array |
| Memory (agent) | `~/.deepseek-code/memory/MEMORY.md` | Text (§-delimited) |
| Memory (user) | `~/.deepseek-code/memory/USER.md` | Text (§-delimited) |
| Settings (user) | `~/.deepseek/settings.json` | JSON |
| Settings (project) | `.deepseek/settings.json` | JSON |
| Settings (local) | `.deepseek/settings.local.json` | JSON |
| MCP config | `.deepseek/mcp.json` | JSON |
| Steering | `.deepseek/steering/*.md` | Markdown |
| Project instructions | `DEEPSEEK.md` or `.deepseek/DEEPSEEK.md` | Markdown |
| Agent configs | `.deepseek/agents/<name>.json` or `~/.deepseek/agents/<name>.json` | JSON |
