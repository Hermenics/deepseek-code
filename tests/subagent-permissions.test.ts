import { describe, test, expect } from 'bun:test'
import { DEFAULT_SUBAGENT_ROLE, getToolNamesForProfile, getToolsForRole } from '../src/tools/SubAgent/permissions.js'
import type { Tool } from '../src/tools/types.js'

// Minimal mock tools covering all names referenced by ROLE_TOOLS
const ALL_TOOLS: Tool[] = [
  'read_file', 'read_folder', 'grep', 'glob',
  'write_file', 'patch_file', 'shell',
  'web_fetch', 'introspect', 'subagent', 'record_claim', 'session_evidence', 'discover_tools',
].map((name) => ({ name, description: name, parameters: {} }) as unknown as Tool)

function names(tools: Tool[]): string[] {
  return tools.map((t) => t.name).sort()
}

describe('getToolsForRole', () => {
  test('reader — returns only read tools', () => {
    const result = getToolsForRole('reader', ALL_TOOLS)
    expect(names(result)).toEqual(
      ['discover_tools', 'glob', 'grep', 'introspect', 'read_file', 'read_folder', 'record_claim', 'session_evidence', 'web_fetch'],
    )
  })

  test('writer — includes read + write tools', () => {
    const result = getToolsForRole('writer', ALL_TOOLS)
    expect(names(result)).toEqual(
      ['discover_tools', 'glob', 'grep', 'introspect', 'patch_file', 'read_file', 'read_folder', 'record_claim', 'session_evidence', 'write_file'],
    )
  })

  test('executor — includes shell', () => {
    const result = getToolsForRole('executor', ALL_TOOLS)
    expect(names(result)).toContain('shell')
    expect(names(result)).toContain('read_file')
    expect(names(result)).toContain('write_file')
    expect(names(result)).toContain('session_evidence')
    expect(names(result)).toContain('discover_tools')
  })

  test('reviewer — only read tools, no writes', () => {
    const result = getToolsForRole('reviewer', ALL_TOOLS)
    expect(names(result)).toEqual(
      ['discover_tools', 'glob', 'grep', 'introspect', 'read_file', 'read_folder', 'record_claim', 'session_evidence'],
    )
    expect(names(result)).not.toContain('write_file')
    expect(names(result)).not.toContain('shell')
  })

  test('unrestricted — returns all tools (including subagent)', () => {
    const result = getToolsForRole('unrestricted', ALL_TOOLS)
    expect(result.length).toBe(ALL_TOOLS.length)
  })
})

describe('default role', () => {
  test('an unnamed role is read-only', () => {
    expect(DEFAULT_SUBAGENT_ROLE).toBe('reader')
  })

  // The role used to be inferred from the task text. Both of these were
  // wrong, in opposite directions, and neither announced itself: the first
  // matched the execute keywords and handed out a shell, the second matched
  // no write keyword and left the agent unable to edit anything.
  test('the narrowest role grants no shell and no writes', () => {
    const granted = names(getToolsForRole(DEFAULT_SUBAGENT_ROLE, ALL_TOOLS))
    expect(granted).not.toContain('shell')
    expect(granted).not.toContain('write_file')
    expect(granted).not.toContain('patch_file')
  })

  test('standard permission profiles include scoped read-only evidence and discovery tools', () => {
    for (const profile of ['researcher-readonly', 'tester', 'writer-worktree'] as const) {
      const granted = getToolNamesForProfile(profile)
      expect(granted).toContain('session_evidence')
      expect(granted).toContain('record_claim')
      expect(granted).toContain('discover_tools')
    }
  })
})
