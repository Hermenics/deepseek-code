import type { PermissionRule, PermissionDecision } from './types.js'

/**
 * Parse a rule string like "Shell(git *)" or "ReadFile" into a PermissionRule.
 */
export function parseRule(raw: string): PermissionRule {
  const match = raw.match(/^(\w+)(?:\((.+)\))?$/)
  if (!match) return { raw, toolName: raw.toLowerCase(), pattern: undefined }
  const toolName = match[1]!.toLowerCase()
  const pattern = match[2]?.trim() || undefined
  return { raw, toolName, pattern }
}

/**
 * Glob-style pattern matching. Supports * as wildcard for any characters.
 * Uses iterative matching to avoid ReDoS with complex patterns.
 */
export function globMatch(pattern: string, value: string): boolean {
  // Safety: limit wildcards to prevent pathological patterns
  const wildcardCount = (pattern.match(/\*/g) || []).length
  if (wildcardCount > 10) return false

  // Iterative glob matching (no regex) — immune to backtracking
  const lowerValue = value.toLowerCase()
  const lowerPattern = pattern.toLowerCase()
  return iterativeGlob(lowerPattern, lowerValue)
}

function iterativeGlob(pattern: string, str: string): boolean {
  let pi = 0, si = 0
  let starPi = -1, starSi = -1

  while (si < str.length) {
    if (pi < pattern.length && (pattern[pi] === str[si] || pattern[pi] === '?')) {
      pi++
      si++
    } else if (pi < pattern.length && pattern[pi] === '*') {
      starPi = pi
      starSi = si
      pi++
    } else if (starPi !== -1) {
      pi = starPi + 1
      starSi++
      si = starSi
    } else {
      return false
    }
  }

  while (pi < pattern.length && pattern[pi] === '*') pi++
  return pi === pattern.length
}

/**
 * Get the relevant content to match against for a tool invocation.
 */
function getMatchContent(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'shell':
      return typeof args.command === 'string' ? args.command : undefined
    case 'read_file':
    case 'write_file':
    case 'patch_file':
      return typeof args.path === 'string' ? args.path : undefined
    case 'web_fetch':
      return typeof args.url === 'string' ? args.url : undefined
    case 'grep':
      return typeof args.pattern === 'string' ? args.pattern : undefined
    default:
      return undefined
  }
}

/**
 * Check if a rule matches a specific tool invocation.
 */
export function matchesRule(rule: PermissionRule, toolName: string, args: Record<string, unknown>): boolean {
  if (rule.toolName !== toolName.toLowerCase()) return false
  if (!rule.pattern) return true
  const content = getMatchContent(toolName.toLowerCase(), args)
  if (content === undefined) return false  // Can't match pattern without content
  return globMatch(rule.pattern, content)
}

/**
 * Resolve permission for a tool invocation against allow/deny rules.
 * Resolution order: deny first -> allow -> fallback = ask (if allow rules exist) or allow (if no rules)
 */
export function resolvePermission(
  permissions: { allow?: string[]; deny?: string[] } | undefined,
  toolName: string,
  args: Record<string, unknown>,
): PermissionDecision {
  if (!permissions) return 'allow'

  const denyRules = (permissions.deny ?? []).map(parseRule)
  const allowRules = (permissions.allow ?? []).map(parseRule)

  // No rules at all = allow everything
  if (denyRules.length === 0 && allowRules.length === 0) return 'allow'

  // Deny rules checked first
  for (const rule of denyRules) {
    if (matchesRule(rule, toolName, args)) return 'deny'
  }

  // Allow rules
  for (const rule of allowRules) {
    if (matchesRule(rule, toolName, args)) return 'allow'
  }

  // Fallback: if only deny rules exist and nothing matched, allow
  // If allow rules exist but nothing matched, ask
  if (allowRules.length > 0) return 'ask'
  return 'allow'
}
