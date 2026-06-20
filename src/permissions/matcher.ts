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
 */
export function globMatch(pattern: string, value: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${regexStr}$`, 'i').test(value)
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
  if (content === undefined) return true
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
