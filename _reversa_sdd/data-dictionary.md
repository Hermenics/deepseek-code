# DeepSeek Code — Data Dictionary

> Re-extracted on 2026-08-01. All entries below are 🟢 **CONFIRMED** source contracts.

## Agent and session

| Entity | Key fields | Meaning |
|---|---|---|
| `ProviderConfig` | `provider`, API/AWS/GCP/local fields | Selected LLM transport and credentials/location data |
| `Goal` | `objective`, `status`, budgets, usage, block counter | Persistent user objective with continuation lifecycle |
| `SessionData` | `id`, timestamps, `cwd`, model/provider, messages, files, `goal` | Persisted, project-scoped conversation state |
| `TokenUsage` | `promptTokens`, `completionTokens`, `cachedTokens` | Cost and context accounting input |
| `ContextBreakdown` | total/limit/categories/suggestions | Context-window diagnostic shown by `/context` |
| `MemoryStore` entries | normalized text, target `agent`/`user` | Bounded durable facts, never executable instructions |
| `AgentConfig` | name, model, system prompt, files, tool allowlist | Custom agent overlay loaded from a registry |

## Orchestration

| Entity | Key fields | Meaning |
|---|---|---|
| `TaskRecordV1` | identity, graph, state, limits, permissions, workspace, result | Persistent task-DAG node |
| `TaskResultEnvelopeV1` | `status`, `value`, `partial`, artifacts, metrics, error | Schema-validated terminal task result |
| `TaskMessageV1` | sender/recipient, type, correlation, payload, status | Idempotent mailbox message |
| `TaskWorkspaceV1` | path, root, isolation, base head, integration flags | Task workspace snapshot |
| `TaskEventV1` | event identity/type/payload/correlation | Redacted observability event |
| `TaskSessionSnapshotV1` | session/root/timestamp/tasks/messages | Atomically persisted orchestration recovery state |
| `TaskLimits` | concurrency, task/depth/fan-out/retry/time/budgets | Runtime guardrails; normalized before use |

Task states are `queued`, `running`, `blocked`, `done`, `failed`, `cancelled`, and `timed_out`. Terminal states are immutable until an explicit resume where permitted.

## Configuration

| Entity | Key fields | Meaning |
|---|---|---|
| `DeepSeekSettings` | provider, model, interaction, compaction, permissions, risk, agents, memory, sessions, git, LSP, MCP, interface, hooks, goal | Effective configuration document |
| `SettingsSnapshot` | effective, legacy, per-level data, origins, issues | Inspectable merge result |
| `PermissionsConfig` | allow, deny, suppress, auto-approve flag | Declarative tool rules |
| `RiskConfig` | enabled, rules, thresholds | High/medium dangerous-operation assessment |
| `HooksConfig` | `PreToolUse`, `PostToolUse`, `SessionStart` | User-scoped shell lifecycle hooks |
| `LspServerSettings` | name, command, args, extensions, language ID | Permitted local language-server definition |
| `InterfaceSettings` | theme, Vim, density, display flags, status-bar order | TUI behavior |

## Extensibility

| Entity | Key fields | Meaning |
|---|---|---|
| `PluginManifest` | name/version/description/component paths | Discovered plugin metadata |
| `PluginEntry` | repo, commit, timestamps, component inventory | Registry record for an installed plugin |
| `SkillManifest` | name, description, optional metadata | Required `SKILL.md` frontmatter |
| `SkillEntry` | repo, commit, timestamps, description | Installed-skill registry record |
| `CatalogEntry` | id, kind, name, source, description | Static curated integration recommendation |

## UI and tools

| Entity | Key fields | Meaning |
|---|---|---|
| `Message` | role and content | Rendered chat/history entry; roles include user, assistant, tool, thinking, terminal |
| `ToolStatus` | tool identity, argument/detail, output state | Live TUI progress for a model tool call |
| `Tool` | name, description, JSON schema, `execute` | Model-callable operation contract |
| `ToolExecutionContext` | session/task/workspace/permissions/abort/session | Capability boundary supplied to a tool |
| `DiffPayload` | path, add/remove count, first line, diff lines | Structured write/patch visualization data |
| `FeatureName` | `wordDiff`, `microCompact`, `fuzzyFileSearch` | Persisted experimental toggle |

## Renderer

The custom terminal renderer holds an internal DOM tree whose nodes map to Yoga layout nodes, styles, attributes, event handlers, focus data and physical screen cells. These are rendering implementation details rather than persistent domain data.
