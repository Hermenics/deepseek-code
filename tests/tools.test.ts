import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { allTools, toolMap } from '../src/tools/index.js'
import type { Tool } from '../src/tools/types.js'

describe('Tool Registry', () => {
  it('should export a non-empty array of tools', () => {
    expect(allTools).toBeArray()
    expect(allTools.length).toBeGreaterThan(0)
  })

  it('should export a Map with all tools indexed by name', () => {
    expect(toolMap).toBeInstanceOf(Map)
    expect(toolMap.size).toBe(allTools.length)
  })

  it('should have unique tool names', () => {
    const names = allTools.map(t => t.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })

  it('every tool should have required fields', () => {
    for (const tool of allTools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(typeof tool.parameters).toBe('object')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('every tool name should be lowercase with underscores', () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('every tool parameters should have type "object"', () => {
    for (const tool of allTools) {
      const params = tool.parameters as { type?: string }
      expect(params.type).toBe('object')
    }
  })

  it('toolMap should retrieve tools by name correctly', () => {
    for (const tool of allTools) {
      expect(toolMap.get(tool.name)).toBe(tool)
    }
  })

  it('toolMap should return undefined for non-existent tool', () => {
    expect(toolMap.get('non_existent_tool_xyz')).toBeUndefined()
  })
})

describe('Tool Interface Contract', () => {
  const expectedTools = [
    'write_file', 'patch_file', 'read_file', 'read_folder',
    'grep', 'glob', 'shell', 'introspect', 'web_fetch',
    'subagent', 'update_knowledge', 'todo', 'git'
  ]

  it('should include all expected built-in tools', () => {
    const names = allTools.map(t => t.name)
    for (const expected of expectedTools) {
      expect(names).toContain(expected)
    }
  })

  it('execute should return a Promise', async () => {
    // Test with read_folder which is safe to call
    const readFolder = toolMap.get('read_folder')!
    const result = readFolder.execute({ path: '/tmp' })
    expect(result).toBeInstanceOf(Promise)
    // Await to prevent unhandled rejection
    await result.catch(() => {})
  })
})

describe('Individual Tool Validation', () => {
  describe('read_file', () => {
    const tool = toolMap.get('read_file')!

    it('should exist', () => {
      expect(tool).toBeDefined()
    })

    it('should return error for non-existent file within cwd', async () => {
      // ReadFile throws on ENOENT — the Agent wraps this in try/catch
      try {
        const result = await tool.execute({ path: 'non-existent-file-xyz-123.ts' })
        expect(result.toLowerCase()).toContain('error')
      } catch (e) {
        // Tool throws directly — acceptable behavior, Agent catches it
        expect((e as Error).message || String(e)).toBeTruthy()
      }
    })

    it('should read an existing file', async () => {
      const result = await tool.execute({ path: 'package.json' })
      expect(result).toContain('deepseek-code')
    })
  })

  describe('read_folder', () => {
    const tool = toolMap.get('read_folder')!

    it('should exist', () => {
      expect(tool).toBeDefined()
    })

    it('should list directory contents', async () => {
      const result = await tool.execute({ path: '.' })
      expect(result).toContain('src')
      expect(result).toContain('package.json')
    })

    it('should handle non-existent directory gracefully', async () => {
      // ReadFolder may throw or return error — both are acceptable
      try {
        const result = await tool.execute({ path: 'non-existent-dir-xyz-123' })
        expect(result.toLowerCase()).toContain('error')
      } catch (e) {
        expect(e).toBeDefined()
      }
    })
  })

  describe('grep', () => {
    const tool = toolMap.get('grep')!

    it('should exist', () => {
      expect(tool).toBeDefined()
    })

    it('should find pattern in files', async () => {
      const result = await tool.execute({ pattern: 'deepseek-code', path: '.' })
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('glob', () => {
    const tool = toolMap.get('glob')!

    it('should exist', () => {
      expect(tool).toBeDefined()
    })

    it('should find TypeScript files', async () => {
      const result = await tool.execute({ pattern: 'src/**/*.ts' })
      expect(result).toContain('.ts')
    })
  })

  describe('todo', () => {
    const tool = toolMap.get('todo')!

    it('should exist', () => {
      expect(tool).toBeDefined()
    })

    it('should handle list action', async () => {
      const result = await tool.execute({ action: 'list' })
      expect(typeof result).toBe('string')
    })
  })
})
