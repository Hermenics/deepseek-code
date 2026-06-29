import { globMatch } from './matcher.js'
import type { RiskRule, RiskConfig, RiskContext, RiskAssessment } from './types.js'

// ── Default Risk Rules ───────────────────────────────────────────────────────

export const DEFAULT_RISK_RULES: RiskRule[] = [
  // HIGH — always require confirmation
  { id: 'shell:rm', level: 'high', tool: 'shell', pattern: 'rm *' },
  { id: 'shell:rm-rf', level: 'high', tool: 'shell', pattern: 'rm -rf *' },
  { id: 'shell:force-push', level: 'high', tool: 'shell', pattern: 'git push *--force*' },
  { id: 'shell:force-push-f', level: 'high', tool: 'shell', pattern: 'git push * -f *' },
  { id: 'shell:force-push-f-end', level: 'high', tool: 'shell', pattern: 'git push * -f' },
  { id: 'shell:force-push-f-imm', level: 'high', tool: 'shell', pattern: 'git push -f *' },
  { id: 'shell:force-push-f-bare', level: 'high', tool: 'shell', pattern: 'git push -f' },
  { id: 'shell:reset-hard', level: 'high', tool: 'shell', pattern: 'git reset --hard*' },
  { id: 'shell:checkout-destructive', level: 'high', tool: 'shell', pattern: 'git checkout -- *' },
  { id: 'shell:clean', level: 'high', tool: 'shell', pattern: 'git clean *' },
  { id: 'shell:npm-install', level: 'high', tool: 'shell', pattern: 'npm install*' },
  { id: 'shell:bun-add', level: 'high', tool: 'shell', pattern: 'bun add*' },
  { id: 'shell:pip-install', level: 'high', tool: 'shell', pattern: 'pip install*' },
  { id: 'shell:apt-install', level: 'high', tool: 'shell', pattern: 'apt install*' },
  { id: 'shell:sudo', level: 'high', tool: 'shell', pattern: 'sudo *' },
  { id: 'shell:systemctl', level: 'high', tool: 'shell', pattern: 'systemctl *' },
  { id: 'shell:docker-rm', level: 'high', tool: 'shell', pattern: 'docker *--rm*' },
  { id: 'shell:chmod', level: 'high', tool: 'shell', pattern: 'chmod *' },
  { id: 'shell:deploy-run', level: 'high', tool: 'shell', pattern: '*run deploy*' },
  { id: 'shell:deploy-script', level: 'high', tool: 'shell', pattern: '*deploy.sh*' },
  { id: 'shell:deploy-cmd', level: 'high', tool: 'shell', pattern: '*serverless deploy*' },
  { id: 'shell:deploy-cdk', level: 'high', tool: 'shell', pattern: 'cdk deploy*' },
  { id: 'shell:build', level: 'high', tool: 'shell', pattern: 'bun run build*' },
  { id: 'write:deepseek-config', level: 'high', tool: 'write_file', pattern: '*.deepseek/*' },
  { id: 'patch:deepseek-config', level: 'high', tool: 'patch_file', pattern: '*.deepseek/*' },
  { id: 'write:steering', level: 'high', tool: 'write_file', pattern: '*.deepseek/steering/*' },
  { id: 'write:large-overwrite', level: 'high', tool: 'write_file', condition: 'large_overwrite' },

  // MEDIUM — require confirmation only in subagent context
  { id: 'shell:git-push', level: 'medium', tool: 'shell', pattern: 'git push*' },
  { id: 'shell:git-commit', level: 'medium', tool: 'shell', pattern: 'git commit*' },
  { id: 'write:config-package', level: 'medium', tool: 'write_file', pattern: '*package.json' },
  { id: 'write:config-tsconfig', level: 'medium', tool: 'write_file', pattern: '*tsconfig*' },
  { id: 'write:config-dockerfile', level: 'medium', tool: 'write_file', pattern: '*Dockerfile*' },
  { id: 'write:burst', level: 'medium', tool: 'write_file', condition: 'multi_edit_burst' },
  { id: 'patch:burst', level: 'medium', tool: 'patch_file', condition: 'multi_edit_burst' },
  { id: 'shell:npm-install-dev', level: 'medium', tool: 'shell', pattern: 'npm install --save-dev*' },
  { id: 'shell:bun-add-dev', level: 'medium', tool: 'shell', pattern: 'bun add -d*' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getToolContent(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'shell':
      if (typeof args.command !== 'string') return undefined
      // Normalize: trim and collapse multiple spaces
      return args.command.trim().replace(/\s+/g, ' ')
    case 'write_file':
    case 'patch_file':
      return typeof args.path === 'string' ? args.path : undefined
    default:
      return undefined
  }
}

// ── Main Assessment ──────────────────────────────────────────────────────────

export function assessRisk(
  toolName: string,
  args: Record<string, unknown>,
  context: RiskContext,
): RiskAssessment | null {
  const { config } = context

  if (config.enabled === false) return null

  const largeThreshold = config.thresholds?.largeFileLines ?? 100
  const burstThreshold = config.thresholds?.burstCount ?? 3

  // Merge: user rules override defaults by id
  const userRulesById = new Map((config.rules ?? []).map(r => [r.id, r]))
  const mergedRules = DEFAULT_RISK_RULES.map(r => userRulesById.get(r.id) ?? r)
  // Append user rules with new ids
  for (const r of config.rules ?? []) {
    if (!DEFAULT_RISK_RULES.some(d => d.id === r.id)) mergedRules.push(r)
  }

  // Sort by specificity (longer pattern first), then by level (high before medium)
  const sorted = mergedRules.sort((a, b) => {
    const lenA = a.pattern?.length ?? 0
    const lenB = b.pattern?.length ?? 0
    if (lenA !== lenB) return lenB - lenA  // longer pattern = more specific = first
    // Same length: high before medium
    return a.level === 'high' ? -1 : 1
  })

  const content = getToolContent(toolName, args)

  for (const rule of sorted) {
    if (rule.tool && rule.tool !== toolName) continue

    let matched = false

    if (rule.pattern) {
      if (content === undefined) continue
      matched = globMatch(rule.pattern, content)
    } else if (rule.condition === 'large_overwrite') {
      // If _existingLineCount is not provided, skip — caller must supply it for the check to apply
      if (typeof args._existingLineCount !== 'number') continue
      matched = args._existingLineCount >= largeThreshold
    } else if (rule.condition === 'multi_edit_burst') {
      matched = context.recentWriteCount >= burstThreshold
    } else if (!rule.pattern && !rule.condition) {
      // Rule with only tool match — matches any use of that tool
      matched = true
    }

    if (!matched) continue

    const requiresConfirmation = rule.level === 'high' ? true : context.isSubAgent

    return {
      level: rule.level,
      matchedRule: rule.id,
      description: rule.description ?? `Matched risk rule: ${rule.id}`,
      requiresConfirmation,
    }
  }

  return null
}
