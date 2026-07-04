import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dsk-plugin-reg-'))
  process.env.DEEPSEEK_PLUGINS_DIR = testDir
})

afterEach(() => {
  delete process.env.DEEPSEEK_PLUGINS_DIR
  rmSync(testDir, { recursive: true, force: true })
})

const sampleEntry = {
  name: 'test-plugin',
  repo: 'owner/test-plugin',
  version: '1.0.0',
  installedAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  commitHash: 'abc123',
  description: 'A test plugin',
  components: { commands: [], agents: [], skills: [], hasHooks: false },
}

describe('readPluginRegistry', () => {
  it('should return empty registry when file does not exist', async () => {
    const { readPluginRegistry } = await import('../../src/plugins/registry.js')
    const result = readPluginRegistry()
    expect(result).toEqual({ version: 1, plugins: {} })
  })

  it('should read back a written registry', async () => {
    const { readPluginRegistry, writePluginRegistry } = await import('../../src/plugins/registry.js')
    const data = { version: 1 as const, plugins: { 'test-plugin': sampleEntry } }
    writePluginRegistry(data)
    const result = readPluginRegistry()
    expect(result).toEqual(data)
  })
})

describe('addPluginToRegistry', () => {
  it('should add a plugin entry to empty registry', async () => {
    const { readPluginRegistry, addPluginToRegistry } = await import('../../src/plugins/registry.js')
    addPluginToRegistry(sampleEntry as any)
    const result = readPluginRegistry()
    expect(result.plugins['test-plugin']).toEqual(sampleEntry)
  })

  it('should add multiple entries', async () => {
    const { readPluginRegistry, addPluginToRegistry } = await import('../../src/plugins/registry.js')
    addPluginToRegistry(sampleEntry as any)
    addPluginToRegistry({ ...sampleEntry, name: 'other-plugin', repo: 'x/other-plugin' } as any)
    const result = readPluginRegistry()
    expect(Object.keys(result.plugins)).toHaveLength(2)
  })

  it('should overwrite entry with same name', async () => {
    const { readPluginRegistry, addPluginToRegistry } = await import('../../src/plugins/registry.js')
    addPluginToRegistry(sampleEntry as any)
    addPluginToRegistry({ ...sampleEntry, commitHash: 'new-hash' } as any)
    const result = readPluginRegistry()
    expect(Object.keys(result.plugins)).toHaveLength(1)
    expect(result.plugins['test-plugin'].commitHash).toBe('new-hash')
  })
})

describe('removePluginFromRegistry', () => {
  it('should remove an existing entry', async () => {
    const { readPluginRegistry, addPluginToRegistry, removePluginFromRegistry } = await import('../../src/plugins/registry.js')
    addPluginToRegistry(sampleEntry as any)
    removePluginFromRegistry('test-plugin')
    const result = readPluginRegistry()
    expect(result.plugins['test-plugin']).toBeUndefined()
  })

  it('should leave other entries intact', async () => {
    const { readPluginRegistry, addPluginToRegistry, removePluginFromRegistry } = await import('../../src/plugins/registry.js')
    addPluginToRegistry(sampleEntry as any)
    addPluginToRegistry({ ...sampleEntry, name: 'keep-me', repo: 'x/keep-me' } as any)
    removePluginFromRegistry('test-plugin')
    const result = readPluginRegistry()
    expect(result.plugins['keep-me']).toBeDefined()
    expect(result.plugins['test-plugin']).toBeUndefined()
  })
})

describe('getPluginEntry', () => {
  it('should return entry when it exists', async () => {
    const { addPluginToRegistry, getPluginEntry } = await import('../../src/plugins/registry.js')
    addPluginToRegistry(sampleEntry as any)
    const entry = getPluginEntry('test-plugin')
    expect(entry).toEqual(sampleEntry)
  })

  it('should return undefined when not found', async () => {
    const { getPluginEntry } = await import('../../src/plugins/registry.js')
    const entry = getPluginEntry('nonexistent')
    expect(entry).toBeUndefined()
  })
})
