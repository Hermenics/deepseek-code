import type { HooksConfig } from '../hooks/types.js'
import type { RiskConfig } from '../permissions/types.js'
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

export type StatusBarItem = 'mode' | 'model' | 'tokens' | 'branch' | 'context'

export interface GoalSettings {
  maxContinuations?: number
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
}

export interface DeepSeekSettings {
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
  interface?: InterfaceSettings
  hooks?: HooksConfig
  goal?: GoalSettings

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
