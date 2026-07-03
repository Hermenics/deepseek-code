import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readRegistry,
  writeRegistry,
  addToRegistry,
  removeFromRegistry,
} from '../../src/skills/registry.js'

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'dsk-skills-test-'))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('readRegistry', () => {
  it('should return default registry when file does not exist', () => {
    const registry = readRegistry(testDir)
    expect(registry).toEqual({ version: 1, skills: {} })
  })

  it('should return default registry when skills dir does not exist', async () => {
    const nonExistentDir = join(testDir, 'nonexistent')
    const registry = readRegistry(nonExistentDir)
    expect(registry).toEqual({ version: 1, skills: {} })
  })

  it('should read back a written registry', () => {
    const data = {
      version: 1 as const,
      skills: {
        'my-skill': {
          name: 'my-skill',
          repo: 'owner/my-skill',
          installedAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          commitHash: 'abc123',
          description: 'A test skill',
        },
      },
    }
    writeRegistry(testDir, data)
    const result = readRegistry(testDir)
    expect(result).toEqual(data)
  })
})

describe('writeRegistry', () => {
  it('should write and persist the registry to disk', () => {
    const registry = {
      version: 1 as const,
      skills: {
        'test-skill': {
          name: 'test-skill',
          repo: 'org/test-skill',
          installedAt: '2024-06-01T00:00:00.000Z',
          updatedAt: '2024-06-01T00:00:00.000Z',
          commitHash: 'deadbeef',
          description: 'Test',
        },
      },
    }
    writeRegistry(testDir, registry)
    const result = readRegistry(testDir)
    expect(result.skills['test-skill'].repo).toBe('org/test-skill')
  })

  it('should overwrite existing registry', () => {
    const first = { version: 1 as const, skills: {} }
    writeRegistry(testDir, first)

    const second = {
      version: 1 as const,
      skills: {
        'new-skill': {
          name: 'new-skill',
          repo: 'a/b',
          installedAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          commitHash: 'ff00ff',
          description: 'New',
        },
      },
    }
    writeRegistry(testDir, second)

    const result = readRegistry(testDir)
    expect(Object.keys(result.skills)).toHaveLength(1)
    expect(result.skills['new-skill']).toBeDefined()
  })
})

describe('addToRegistry', () => {
  it('should add a skill entry to an empty registry', () => {
    const entry = {
      name: 'cool-tool',
      repo: 'owner/cool-tool',
      installedAt: '2024-03-15T12:00:00.000Z',
      updatedAt: '2024-03-15T12:00:00.000Z',
      commitHash: '1a2b3c',
      description: 'A cool tool',
    }
    addToRegistry(testDir, entry)
    const result = readRegistry(testDir)
    expect(result.skills['cool-tool']).toEqual(entry)
  })

  it('should add multiple skill entries', () => {
    const entry1 = {
      name: 'skill-one',
      repo: 'a/skill-one',
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      commitHash: 'aaa',
      description: 'First',
    }
    const entry2 = {
      name: 'skill-two',
      repo: 'b/skill-two',
      installedAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      commitHash: 'bbb',
      description: 'Second',
    }
    addToRegistry(testDir, entry1)
    addToRegistry(testDir, entry2)
    const result = readRegistry(testDir)
    expect(Object.keys(result.skills)).toHaveLength(2)
    expect(result.skills['skill-one']).toEqual(entry1)
    expect(result.skills['skill-two']).toEqual(entry2)
  })

  it('should overwrite existing entry with same name', () => {
    const original = {
      name: 'my-skill',
      repo: 'a/my-skill',
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      commitHash: 'old',
      description: 'Old version',
    }
    addToRegistry(testDir, original)

    const updated = { ...original, commitHash: 'new', description: 'New version' }
    addToRegistry(testDir, updated)

    const result = readRegistry(testDir)
    expect(Object.keys(result.skills)).toHaveLength(1)
    expect(result.skills['my-skill'].commitHash).toBe('new')
  })
})

describe('removeFromRegistry', () => {
  it('should remove an existing skill entry', () => {
    const entry = {
      name: 'to-remove',
      repo: 'x/to-remove',
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      commitHash: 'abc',
      description: 'Will be removed',
    }
    addToRegistry(testDir, entry)
    removeFromRegistry(testDir, 'to-remove')
    const result = readRegistry(testDir)
    expect(result.skills['to-remove']).toBeUndefined()
  })

  it('should not throw when removing a non-existent entry', () => {
    expect(() => removeFromRegistry(testDir, 'does-not-exist')).not.toThrow()
  })

  it('should leave other entries intact when removing one', () => {
    const keep = {
      name: 'keep-me',
      repo: 'a/keep-me',
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      commitHash: 'kkk',
      description: 'Keep this',
    }
    const remove = {
      name: 'remove-me',
      repo: 'b/remove-me',
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      commitHash: 'rrr',
      description: 'Remove this',
    }
    addToRegistry(testDir, keep)
    addToRegistry(testDir, remove)
    removeFromRegistry(testDir, 'remove-me')
    const result = readRegistry(testDir)
    expect(result.skills['keep-me']).toEqual(keep)
    expect(result.skills['remove-me']).toBeUndefined()
  })

  it('should be a no-op on an empty registry', () => {
    expect(() => removeFromRegistry(testDir, 'ghost')).not.toThrow()
    const result = readRegistry(testDir)
    expect(result).toEqual({ version: 1, skills: {} })
  })
})
