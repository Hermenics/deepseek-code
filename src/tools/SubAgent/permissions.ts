/**
 * Role-based tool filtering for subagents.
 */

import type { Tool } from '../types.js'
import type { PermissionProfile } from '../../orchestration/types.js'

export type SubAgentRole = 'reader' | 'writer' | 'executor' | 'reviewer' | 'unrestricted'

const ROLE_TOOLS: Record<SubAgentRole, Set<string> | '*'> = {
  reader: new Set(['read_file', 'read_folder', 'grep', 'glob', 'lsp', 'web_fetch', 'introspect']),
  writer: new Set(['read_file', 'read_folder', 'grep', 'glob', 'write_file', 'patch_file', 'introspect']),
  executor: new Set(['read_file', 'read_folder', 'grep', 'glob', 'write_file', 'patch_file', 'shell', 'web_fetch', 'introspect']),
  reviewer: new Set(['read_file', 'read_folder', 'grep', 'glob', 'lsp', 'introspect']),
  unrestricted: '*',
}

const PROFILE_TOOLS: Record<PermissionProfile, Set<string> | '*'> = {
  'researcher-readonly': new Set(['read_file', 'read_folder', 'grep', 'glob', 'lsp', 'web_fetch', 'introspect']),
  tester: new Set(['read_file', 'read_folder', 'grep', 'glob', 'shell', 'introspect']),
  'writer-worktree': new Set(['read_file', 'read_folder', 'grep', 'glob', 'write_file', 'patch_file', 'edit_file', 'shell', 'introspect']),
  'coordinator-integrator': '*',
}

export function isToolAllowedForProfile(profile: PermissionProfile, toolName: string): boolean {
  const tools = PROFILE_TOOLS[profile]
  return tools === '*' || tools.has(toolName)
}

export function getToolNamesForProfile(profile: PermissionProfile): string[] | '*' {
  const tools = PROFILE_TOOLS[profile]
  return tools === '*' ? '*' : [...tools]
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
 * The role a delegation gets when the caller names none.
 *
 * This used to be inferred by matching keywords against the task description,
 * which decided a privilege boundary by reading prose that the model itself
 * usually wrote. It failed in both directions: "check if the build passes"
 * matched both the read list and the execute list and came out `executor`,
 * while "fix the typo" matched no write keyword at all and came out `reader`,
 * leaving the agent unable to do the one thing it was asked to do.
 *
 * A privilege is now something a caller states. Omitting it is not a hint to
 * be interpreted, it is the absence of a request, and the answer to that is
 * the narrowest role.
 */
export const DEFAULT_SUBAGENT_ROLE: SubAgentRole = 'reader'

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
