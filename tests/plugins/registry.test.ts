import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readPluginRegistry,
  writePluginRegistry,
  addPluginToRegistry,
  removePluginFromRegistry,
  getPluginEntry,
} from '../../src/plugins/registry.js'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dsk-plugin-reg-'))
})

afterEach(() => {
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
  it('should return empty registry when file does not exist', () => {
    const result = readPluginRegistry(testDir)
    expect(result).toEqual({ version: 1, plugins: {} })
  })

  it('should read back a written registry', () => {
    const data = { version: 1 as const, plugins: { 'test-plugin': sampleEntry } }
    writePluginRegistry(data, testDir)
    const result = readPluginRegistry(testDir)
    expect(result).toEqual(data)
  })
})

describe('addPluginToRegistry', () => {
  it('should add a plugin entry to empty registry', () => {
    addPluginToRegistry(sampleEntry as any, testDir)
    const result = readPluginRegistry(testDir)
    expect(result.plugins['test-plugin']).toEqual(sampleEntry)
  })

  it('should add multiple entries', () => {
    addPluginToRegistry(sampleEntry as any, testDir)
    addPluginToRegistry({ ...sampleEntry, name: 'other-plugin', repo: 'x/other-plugin' } as any, testDir)
    const result = readPluginRegistry(testDir)
    expect(Object.keys(result.plugins)).toHaveLength(2)
  })

  it('should overwrite entry with same name', () => {
    addPluginToRegistry(sampleEntry as any, testDir)
    addPluginToRegistry({ ...sampleEntry, commitHash: 'new-hash' } as any, testDir)
    const result = readPluginRegistry(testDir)
    expect(Object.keys(result.plugins)).toHaveLength(1)
    expect(result.plugins['test-plugin'].commitHash).toBe('new-hash')
  })
})

describe('removePluginFromRegistry', () => {
  it('should remove an existing entry', () => {
    addPluginToRegistry(sampleEntry as any, testDir)
    removePluginFromRegistry('test-plugin', testDir)
    const result = readPluginRegistry(testDir)
    expect(result.plugins['test-plugin']).toBeUndefined()
  })

  it('should leave other entries intact', () => {
    addPluginToRegistry(sampleEntry as any, testDir)
    addPluginToRegistry({ ...sampleEntry, name: 'keep-me', repo: 'x/keep-me' } as any, testDir)
    removePluginFromRegistry('test-plugin', testDir)
    const result = readPluginRegistry(testDir)
    expect(result.plugins['keep-me']).toBeDefined()
    expect(result.plugins['test-plugin']).toBeUndefined()
  })
})

describe('getPluginEntry', () => {
  it('should return entry when it exists', () => {
    addPluginToRegistry(sampleEntry as any, testDir)
    const entry = getPluginEntry('test-plugin', testDir)
    expect(entry).toEqual(sampleEntry)
  })

  it('should return undefined when not found', () => {
    const entry = getPluginEntry('nonexistent', testDir)
    expect(entry).toBeUndefined()
  })
})
