/**
 * Check if a hook pattern matches a tool name.
 * Patterns: "*" matches all, "Shell" exact match, "Shell|WriteFile" pipe-separated list
 */
export function matchesHookPattern(pattern: string, toolName: string): boolean {
  if (!pattern || pattern === '*') return true
  const parts = pattern.split('|').map((p) => p.trim().toLowerCase())
  return parts.includes(toolName.toLowerCase())
}
