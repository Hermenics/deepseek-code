export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export interface PermissionRule {
  raw: string          // original string e.g. "Shell(git *)"
  toolName: string     // normalized tool name e.g. "shell"
  pattern?: string     // content pattern e.g. "git *" (undefined = matches all uses)
}

export type PermissionDecision = 'allow' | 'deny' | 'ask'

// ── Risk Level System ────────────────────────────────────────────────────────
export type RiskLevel = 'high' | 'medium'
// Anything that matches no rule defaults to low risk (allowed without confirmation).

export interface RiskRule {
  id: string              // human-readable key, e.g. "shell:rm"
  level: RiskLevel        // 'high' = always asks; 'medium' = asks only in subagents.
  enabled?: boolean
  tool?: string           // tool name, e.g. "shell", "write_file"
  pattern?: string        // Glob for a command or path.
  condition?: 'large_overwrite' | 'outside_project' | 'config_file' | 'multi_edit_burst'
  description?: string    // Shown in the confirmation prompt.
}

export interface RiskConfig {
  enabled?: boolean       // default true
  rules?: RiskRule[]      // override/extend default rules
  thresholds?: {
    largeFileLines?: number     // default 100
    burstCount?: number         // default 3
  }
}

export interface RiskContext {
  isSubAgent: boolean
  recentWriteCount: number
  config: RiskConfig
}

export interface RiskAssessment {
  level: RiskLevel
  matchedRule: string     // ID of the rule that matched
  description: string     // human-readable reason
  requiresConfirmation: boolean
}
