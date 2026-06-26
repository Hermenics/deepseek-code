/**
 * Role-based tool filtering for subagents.
 */

import type { Tool } from '../types.js'

export type SubAgentRole = 'reader' | 'writer' | 'executor' | 'reviewer' | 'unrestricted'

const ROLE_TOOLS: Record<SubAgentRole, Set<string> | '*'> = {
  reader: new Set(['read_file', 'read_folder', 'grep', 'glob', 'web_fetch', 'introspect']),
  writer: new Set(['read_file', 'read_folder', 'grep', 'glob', 'write_file', 'patch_file', 'introspect']),
  executor: new Set(['read_file', 'read_folder', 'grep', 'glob', 'write_file', 'patch_file', 'shell', 'web_fetch', 'introspect']),
  reviewer: new Set(['read_file', 'read_folder', 'grep', 'glob', 'introspect']),
  unrestricted: '*',
}

/**
 * Filter tools based on the subagent's role.
 * 'unrestricted' returns all tools (minus subagent itself, handled elsewhere).
 */
export function getToolsForRole(role: SubAgentRole, tools: Tool[]): Tool[] {
  const allowed = ROLE_TOOLS[role]
  if (allowed === '*') return tools
  return tools.filter((t) => allowed.has(t.name))
}

/**
 * Infer a role from the task description.
 * Defaults to 'executor' for ambiguous tasks.
 */
export function inferRole(task: string): SubAgentRole {
  const lower = task.toLowerCase()

  // Read-only patterns
  if (/\b(read|analyze|inspect|list|find|search|check|look|review|audit|summarize|count)\b/.test(lower) &&
      !/\b(write|create|fix|update|modify|change|refactor|delete|run|execute|install|build)\b/.test(lower)) {
    // If it mentions review/audit specifically, use reviewer (even more restricted)
    if (/\b(review|audit|check for)\b/.test(lower)) return 'reviewer'
    return 'reader'
  }

  // Write patterns without shell execution
  if (/\b(write|create|add|update|modify|refactor|rename)\b/.test(lower) &&
      !/\b(run|execute|install|build|test|deploy|npm|pip|cargo)\b/.test(lower)) {
    return 'writer'
  }

  // Default: executor (can read, write, and run commands)
  return 'executor'
}

/**
 * Human-readable description of what a role can do.
 */
export function describeRole(role: SubAgentRole): string {
  switch (role) {
    case 'reader': return 'Read-only: can read files, search, and fetch web content'
    case 'writer': return 'Read/write: can read and modify files, but cannot run shell commands'
    case 'executor': return 'Full dev: can read, write files, and run shell commands'
    case 'reviewer': return 'Review-only: can read files and search (no writes, no shell)'
    case 'unrestricted': return 'Unrestricted: all tools available'
  }
}
