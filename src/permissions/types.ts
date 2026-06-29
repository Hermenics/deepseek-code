export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export interface PermissionRule {
  raw: string          // original string e.g. "Shell(git *)"
  toolName: string     // normalized tool name e.g. "shell"
  pattern?: string     // content pattern e.g. "git *" (undefined = matches all uses)
}

export type PermissionDecision = 'allow' | 'deny' | 'ask'

// ── Risk Level System ────────────────────────────────────────────────────────
export type RiskLevel = 'high' | 'medium'
// Tudo que não matcha nenhuma regra = low implícito (passa sem confirmar)

export interface RiskRule {
  id: string              // human-readable key, e.g. "shell:rm"
  level: RiskLevel        // 'high' = sempre pede, 'medium' = pede só em subagent
  tool?: string           // tool name, e.g. "shell", "write_file"
  pattern?: string        // glob para comando/path
  condition?: 'large_overwrite' | 'outside_project' | 'config_file' | 'multi_edit_burst'
  description?: string    // mostrado no prompt de confirmação
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
  matchedRule: string     // rule id que triggerou
  description: string     // human-readable reason
  requiresConfirmation: boolean
}
