import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dsk-plugin-install-'))
  process.env.DEEPSEEK_PLUGINS_DIR = testDir
})

afterEach(() => {
  delete process.env.DEEPSEEK_PLUGINS_DIR
  rmSync(testDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('removePlugin', () => {
  it('should reject invalid name', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('../escape')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('should reject uppercase name', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('BAD')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('should return error for non-existent plugin', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('ghost-plugin')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('should remove a registered plugin', async () => {
    const { addPluginToRegistry, readPluginRegistry } = await import('../../src/plugins/registry.js')
    const { removePlugin } = await import('../../src/plugins/installer.js')
    // Setup: create plugin dir and registry entry
    const pluginDir = join(testDir, 'my-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'my-plugin' }))
    addPluginToRegistry({
      name: 'my-plugin', repo: 'x/my-plugin', version: '1.0.0',
      installedAt: '', updatedAt: '', commitHash: '', description: '',
      components: { commands: [], agents: [], skills: [], hasHooks: false },
    })
    const result = await removePlugin('my-plugin')
    expect(result.ok).toBe(true)
    expect(readPluginRegistry().plugins['my-plugin']).toBeUndefined()
  })
})

describe('updatePlugin', () => {
  it('should return error for non-installed plugin', async () => {
    const { updatePlugin } = await import('../../src/plugins/installer.js')
    const result = await updatePlugin('not-here')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not installed/i)
  })

  it('should reject invalid name', async () => {
    const { updatePlugin } = await import('../../src/plugins/installer.js')
    const result = await updatePlugin('../sneaky')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })
})

describe('installPlugin', () => {
  it('should reject invalid repo format', async () => {
    const { installPlugin } = await import('../../src/plugins/installer.js')
    const result = await installPlugin('no-slash')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid repo/i)
  })

  it('should reject repo with special chars', async () => {
    const { installPlugin } = await import('../../src/plugins/installer.js')
    const result = await installPlugin('owner/repo; rm -rf /')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/invalid repo/i)
  })
})

describe('path safety', () => {
  it('should reject path traversal names in remove', async () => {
    const { removePlugin } = await import('../../src/plugins/installer.js')
    const result = await removePlugin('../escape')
    expect(result.ok).toBe(false)
  })

  it('should reject path traversal names in update', async () => {
    const { updatePlugin } = await import('../../src/plugins/installer.js')
    const result = await updatePlugin('../escape')
    expect(result.ok).toBe(false)
  })
})
