import type { HooksConfig } from '../hooks/types.js'

export type SettingsLevel = 'user' | 'project' | 'local'

export interface PermissionsConfig {
  allow?: string[] // e.g. ["Shell(git *)", "ReadFile"]
  deny?: string[] // e.g. ["WriteFile(*.env)", "Shell(rm *)"]
}

export interface DeepSeekSettings {
  permissions?: PermissionsConfig
  hooks?: HooksConfig
  model?: string
  theme?: string
  language?: string
  autoCompact?: boolean
  autoCompactThreshold?: number // 0.0-1.0, default 0.90
  promptRefiner?: {
    enabled?: boolean
    model?: string  // optional override — uses main model if not set
  }
  [key: string]: unknown // extensible
}
