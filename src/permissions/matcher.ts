import type { PermissionRule, PermissionDecision } from './types.js'
import { browserActionKind, browserApprovalKey, browserTarget, originOf } from './browser.js'

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

/** Linear-time `*`/`?` glob match with single-star backtracking, avoiding regex catastrophic backtracking. */
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
    case 'read_folder':
    case 'write_file':
    case 'patch_file':
      return typeof args.path === 'string' ? args.path : undefined
    case 'web_fetch':
      return typeof args.url === 'string' ? normalizeUrl(args.url) : undefined
    case 'browser': {
      // `browser(navigate http://localhost:3000/*)`, `browser(click https://example.com/*)`, `browser(* http://localhost:*)`
      const target = browserTarget(args)
      return typeof args.action === 'string' ? `${args.action} ${target ? normalizeUrl(target) : ''}`.trim() : undefined
    }
    case 'grep':
      return typeof args.pattern === 'string' ? args.pattern : undefined
    default:
      return undefined
  }
}

/** Canonical form of a URL (`https://host/` rather than `https://HOST`), so origin-scoped rules match consistently; the raw text when it does not parse. */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

/** Tools whose session approvals are scoped to the origin of their target URL. */
const ORIGIN_SCOPED_TOOLS = new Set(['web_fetch'])

/**
 * Key a session approval is stored under: `web_fetch@https://host` for
 * origin-scoped tools, so approving one site never approves another; the
 * tool name otherwise.
 */
export function approvalKey(toolName: string, args: Record<string, unknown>): string {
  if (toolName.toLowerCase() === 'browser') return browserApprovalKey(args)
  // A dev server approval covers one exact launch.json entry (its hash, injected by the agent).
  if (toolName.toLowerCase() === 'dev_server' && typeof args.__launch === 'string') return `dev_server@${args.__launch}`
  const origin = approvalOrigin(toolName, args)
  return origin ? `${toolName.toLowerCase()}@${origin}` : toolName
}

/** Origin an origin-scoped tool call targets, or undefined when the tool is not origin-scoped or has no parsable URL. */
export function approvalOrigin(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName.toLowerCase() === 'browser') return originOf(browserTarget(args))
  if (!ORIGIN_SCOPED_TOOLS.has(toolName.toLowerCase()) || typeof args.url !== 'string') return undefined
  try {
    const origin = new URL(args.url).origin
    return origin === 'null' ? undefined : origin
  } catch {
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
  if (toolName.toLowerCase() === 'git' && args.action === 'batch' && Array.isArray(args.operations)) {
    const decisions = args.operations.map(operation => resolvePermission(permissions, 'git', {
      action: (operation as Record<string, unknown>)?.action,
    }))
    return decisions.includes('deny') ? 'deny' : decisions.includes('ask') ? 'ask' : 'allow'
  }
  if (['read_file', 'read_folder'].includes(toolName.toLowerCase()) && Array.isArray(args.paths)) {
    const decisions = args.paths.map(path => resolvePermission(permissions, toolName, { path }))
    return decisions.includes('deny') ? 'deny' : decisions.includes('ask') ? 'ask' : 'allow'
  }
  if (toolName.toLowerCase() === 'browser' && args.action === 'batch' && Array.isArray(args.steps)) {
    // Each step is judged on its own, on the page the batch acts on.
    const decisions = args.steps.map(step => resolvePermission(permissions, 'browser', { ...(step as Record<string, unknown>), __origin: args.__origin }))
    return decisions.includes('deny') ? 'deny' : decisions.includes('ask') ? 'ask' : 'allow'
  }
  if (toolName.toLowerCase() === 'grep' && Array.isArray(args.patterns)) {
    const decisions = args.patterns.map(pattern => resolvePermission(permissions, 'grep', { pattern }))
    return decisions.includes('deny') ? 'deny' : decisions.includes('ask') ? 'ask' : 'allow'
  }
  const normalizedToolName = toolName.toLowerCase()
  // Reading a browser page the user already approved needs no prompt; navigating and acting do.
  const defaultDecision = (): PermissionDecision =>
    normalizedToolName === 'shell' || normalizedToolName === 'web_fetch' || (normalizedToolName === 'browser' && browserActionKind(args) !== 'read') ||
    (normalizedToolName === 'dev_server' && args.action === 'start') ? 'ask' : 'allow'

  if (!permissions) return defaultDecision()

  const denyRules = (permissions.deny ?? []).map(parseRule)
  const allowRules = (permissions.allow ?? []).map(parseRule)

  // Shell and network-capable tools are approval-gated in untrusted workspaces.
  if (denyRules.length === 0 && allowRules.length === 0) return defaultDecision()

  // Deny rules checked first
  for (const rule of denyRules) {
    if (matchesRule(rule, toolName, args)) return 'deny'
  }

  // Allow rules
  for (const rule of allowRules) {
    if (matchesRule(rule, toolName, args)) return 'allow'
  }

  // If allow rules exist but nothing matched, ask. Deny-only policies retain
  // their historical allow fallback for ordinary tools, but shell/network
  // capabilities remain approval-gated by default.
  if (allowRules.length > 0 && !(normalizedToolName === 'browser' && browserActionKind(args) === 'read')) return 'ask'
  return defaultDecision()
}
