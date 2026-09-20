import type { HooksConfig } from '../hooks/types.js'
import type { RiskConfig } from '../permissions/types.js'
import type { BudgetLevel } from './budget.js'
import type { ProviderName, ThemeName } from '../types/provider.js'
import type { InteractionMode } from '../ui/interactionMode.js'

export type SettingsLevel = 'user' | 'project' | 'local'
export type SettingOrigin = SettingsLevel | 'default' | 'legacy'
export type SettingPath = string

export interface ValidationIssue {
  path: SettingPath
  level?: SettingsLevel
  severity: 'error' | 'warning'
  message: string
}

export interface SettingsFileState {
  level: SettingsLevel
  path: string
  data: DeepSeekSettings
  error?: string
}

export interface SettingResolution {
  path: SettingPath
  value: unknown
  origin: SettingOrigin
  overrides: Array<{ level: SettingOrigin; value: unknown }>
}

export interface SettingsSnapshot {
  effective: DeepSeekSettings
  legacy: DeepSeekSettings
  levels: Record<SettingsLevel, SettingsFileState>
  origins: Record<SettingPath, SettingOrigin>
  issues: ValidationIssue[]
  unknownPaths: string[]
  loadedAt: string
}

export interface PermissionsConfig {
  allow?: string[]
  deny?: string[]
  /** Exact inherited rules suppressed at this scope. Deny rules cannot be suppressed. */
  suppress?: string[]
  autoApproveLowRisk?: boolean
}

export interface ProviderSettings {
  name?: ProviderName
  /** User-scoped id of the selected private provider profile. */
  activeProfileId?: string
  endpoint?: string
  region?: string
  profile?: string
  projectId?: string
  location?: string
  timeoutMs?: number
}

export interface ModelSettings {
  default?: string
  subagent?: string
  /**
   * Output-token ceiling sent as max_tokens. Without it the official DeepSeek API defaults to a
   * few thousand tokens and silently cuts long tool calls; other providers keep their own default.
   */
  maxOutputTokens?: number
  /** Sampling temperature (0–2). Omitted by default so the provider's default applies. */
  temperature?: number
}

export interface InteractionSettings {
  defaultMode?: InteractionMode
}

export interface CompactionSettings {
  enabled?: boolean
  threshold?: number
}

export interface PromptRefinerSettings {
  enabled?: boolean
  model?: string
  minimumLength?: number
  excludeTypes?: string[]
}

export interface AgentsSettings {
  default?: string
  additionalDirectories?: string[]
  basePrompt?: string
  subagentModel?: string
  concurrency?: number
  permissionPolicy?: 'inherit' | 'isolated'
  disabledBuiltins?: string[]
  maxTasks?: number
  maxDepth?: number
  maxFanOut?: number
  maxRetries?: number
  timeoutMs?: number
  retryBackoffMs?: number
  maxTokens?: number
  maxCostUsd?: number
  /**
   * Shell command a subagent's changes must survive, e.g. `bun run typecheck`.
   * Runs in the subagent's workspace whenever it changed a file, and a
   * non-zero exit refutes the result before any model reviews it. Unset
   * means the project is never built or tested as part of verification.
   */
  verifyCommand?: string
}

export interface MemorySettings {
  enabled?: boolean
  scope?: 'user' | 'project'
}

export interface SessionsSettings {
  retention?: number
  autoResume?: 'off' | 'project-last'
}

export interface GitSettings {
  checkpoint?: boolean
  worktree?: 'off' | 'ask' | 'auto'
  branchPattern?: string
  reviewDiff?: boolean
  verifyAfterEdit?: boolean
  generatedPatterns?: string[]
}

export interface LspServerSettings {
  name: string
  command: string
  args?: string[]
  extensions: string[]
  languageId?: string
}

export interface LspSettings {
  servers?: LspServerSettings[]
  timeoutMs?: number
}

export interface McpSettings {
  enabled?: boolean
}

export type StatusBarItem = 'mode' | 'model' | 'tokens' | 'branch' | 'context'

export interface GoalSettings {
  maxContinuations?: number
}

export interface WorkflowsSettings {
  enabled?: boolean
}

/** User-configurable input bindings. Unknown actions are ignored by the input resolver. */
export type KeybindingValue = string | readonly string[] | null
export interface KeybindingsSettings {
  [action: string]: KeybindingValue
}

/**
 * Optional trusted status-line extension. The command receives the current
 * activity snapshot as JSON on stdin and returns one JSON object per line:
 * `{ "id": "task-id", "content": "decoration" }`.
 */
export interface SubagentStatusLineSettings {
  type: 'command'
  command: string
}

export interface InterfaceSettings {
  theme?: ThemeName
  language?: string
  vim?: boolean
  density?: 'compact' | 'comfortable'
  reducedMotion?: boolean
  alternateScreen?: boolean
  showThoughts?: boolean
  showToolCalls?: boolean
  showDiffs?: boolean
  statusBar?: StatusBarItem[]
  narrowPriority?: StatusBarItem[]
  keybindings?: KeybindingsSettings
  /** Executed only after the host establishes workspace trust. */
  subagentStatusLine?: SubagentStatusLineSettings
}

export interface DeepSeekSettings {
  /**
   * How much the session may spend on itself. Moves several cost knobs at
   * once, and always from below: anything set explicitly in a settings file
   * still wins. See settings/budget.ts for the table.
   */
  budget?: BudgetLevel
  provider?: ProviderSettings
  model?: string | ModelSettings
  interaction?: InteractionSettings
  compaction?: CompactionSettings
  promptRefiner?: PromptRefinerSettings
  permissions?: PermissionsConfig
  risk?: RiskConfig
  agents?: AgentsSettings
  memory?: MemorySettings
  sessions?: SessionsSettings
  git?: GitSettings
  /** User-scoped executable language-server configuration. */
  lsp?: LspSettings
  /** User-scoped permission to load project MCP servers. */
  mcp?: McpSettings
  interface?: InterfaceSettings
  hooks?: HooksConfig
  goal?: GoalSettings
  workflows?: WorkflowsSettings
  /** Compatibility location for integrations that keep keybindings top-level. */
  keybindings?: KeybindingsSettings

  // Legacy settings remain readable for one compatibility cycle.
  theme?: ThemeName | string
  language?: string
  autoCompact?: boolean
  autoCompactThreshold?: number
  [key: string]: unknown
}

export interface SettingsExport {
  version: 1
  exportedAt: string
  settings: DeepSeekSettings
  memory?: unknown
  sessions?: unknown
}
