import type { PermissionsConfig } from '../settings/types.js'
import { getToolsForMode, type InteractionMode } from '../ui/interactionMode.js'
import { DEFAULT_RISK_RULES } from './risk.js'
import type { RiskConfig } from './types.js'

export interface PermissionsReportInput {
  mode: InteractionMode
  allowedTools: string[] | '*' | null
  sessionApproved: string[]
  modeTools?: string[]
  permissions?: PermissionsConfig
  risk?: RiskConfig
}

function formatList(items: string[]): string {
  return items.length > 0 ? [...items].sort().join(', ') : 'none'
}

function riskStatus(config: RiskConfig | undefined): string {
  if (config?.enabled === false) return 'disabled'

  const high = DEFAULT_RISK_RULES.filter((rule) => rule.level === 'high').length
  const medium = DEFAULT_RISK_RULES.filter((rule) => rule.level === 'medium').length
  const custom = (config?.rules ?? []).filter(
    (rule) => !DEFAULT_RISK_RULES.some((defaultRule) => defaultRule.id === rule.id),
  ).length
  const overrides = (config?.rules ?? []).length - custom
  const thresholdParts = [
    `large overwrite >= ${config?.thresholds?.largeFileLines ?? 100} lines`,
    `write burst >= ${config?.thresholds?.burstCount ?? 3} writes`,
  ]

  return [
    `enabled (${high} high, ${medium} medium default rules)`,
    custom > 0 ? `${custom} custom rule${custom === 1 ? '' : 's'}` : null,
    overrides > 0 ? `${overrides} override${overrides === 1 ? '' : 's'}` : null,
    `thresholds: ${thresholdParts.join(', ')}`,
  ].filter(Boolean).join('; ')
}

export function formatPermissionsReport(input: PermissionsReportInput): string {
  const modeTools = input.modeTools ?? getToolsForMode(input.mode)
  const allowRules = input.permissions?.allow ?? []
  const denyRules = input.permissions?.deny ?? []
  const lines: string[] = []

  lines.push(`**Current mode:** ${input.mode}`)
  lines.push(`**Tools allowed in mode:** ${formatList(modeTools)}`)

  if (input.allowedTools === null) {
    lines.push('**Agent allowlist:** no agent-specific allowlist')
  } else if (input.allowedTools === '*') {
    lines.push('**Agent allowlist:** all tools require confirmation')
  } else {
    lines.push(`**Agent allowlist:** ${formatList(input.allowedTools)}`)
  }

  lines.push(`**Settings allow rules:** ${formatList(allowRules)}`)
  lines.push(`**Settings deny rules:** ${formatList(denyRules)}`)
  lines.push(`**Risk checks:** ${riskStatus(input.risk)}`)
  lines.push(`**Approved this session:** ${formatList(input.sessionApproved)}`)
  lines.push('')
  lines.push('Decision order: mode gate -> risk rules in Build mode -> settings allow/deny rules outside Build mode -> agent allowlist -> hooks -> tool execution.')

  return lines.join('\n')
}
