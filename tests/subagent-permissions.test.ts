import { describe, test, expect } from 'bun:test'
import { getToolsForRole, inferRole } from '../src/tools/SubAgent/permissions.js'
import type { Tool } from '../src/tools/types.js'

// Minimal mock tools covering all names referenced by ROLE_TOOLS
const ALL_TOOLS: Tool[] = [
  'read_file', 'read_folder', 'grep', 'glob',
  'write_file', 'patch_file', 'shell',
  'web_fetch', 'introspect', 'subagent',
].map((name) => ({ name, description: name, parameters: {} }) as unknown as Tool)

function names(tools: Tool[]): string[] {
  return tools.map((t) => t.name).sort()
}

describe('getToolsForRole', () => {
  test('reader — returns only read tools', () => {
    const result = getToolsForRole('reader', ALL_TOOLS)
    expect(names(result)).toEqual(
      ['glob', 'grep', 'introspect', 'read_file', 'read_folder', 'web_fetch'],
    )
  })

  test('writer — includes read + write tools', () => {
    const result = getToolsForRole('writer', ALL_TOOLS)
    expect(names(result)).toEqual(
      ['glob', 'grep', 'introspect', 'patch_file', 'read_file', 'read_folder', 'write_file'],
    )
  })

  test('executor — includes shell', () => {
    const result = getToolsForRole('executor', ALL_TOOLS)
    expect(names(result)).toContain('shell')
    expect(names(result)).toContain('read_file')
    expect(names(result)).toContain('write_file')
  })

  test('reviewer — only read tools, no writes', () => {
    const result = getToolsForRole('reviewer', ALL_TOOLS)
    expect(names(result)).toEqual(
      ['glob', 'grep', 'introspect', 'read_file', 'read_folder'],
    )
    expect(names(result)).not.toContain('write_file')
    expect(names(result)).not.toContain('shell')
  })

  test('unrestricted — returns all tools (including subagent)', () => {
    const result = getToolsForRole('unrestricted', ALL_TOOLS)
    expect(result.length).toBe(ALL_TOOLS.length)
  })
})

describe('inferRole', () => {
  test('"review this code" → reviewer', () => {
    expect(inferRole('review this code')).toBe('reviewer')
  })

  test('"write a function" → writer', () => {
    expect(inferRole('write a function that parses JSON')).toBe('writer')
  })

  test('"run the tests" → executor', () => {
    expect(inferRole('run the tests')).toBe('executor')
  })

  test('"find all usages" → reader', () => {
    expect(inferRole('find all usages of this function')).toBe('reader')
  })

  test('ambiguous task → reader (least privilege)', () => {
    expect(inferRole('do the thing')).toBe('reader')
  })
})
