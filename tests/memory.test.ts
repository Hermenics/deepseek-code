import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { loadMemory, addEntry, replaceEntry, removeEntry, getMemorySnapshot, setMemoryDir } from '../src/agent/memory.js'

const TEST_DIR = join(tmpdir(), `deepseek-mem-test-${process.pid}-${Date.now()}`)

describe('Memory System', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
    setMemoryDir(TEST_DIR)
  })

  afterEach(async () => {
    setMemoryDir(null)
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('loadMemory', () => {
    it('returns empty array when file does not exist', async () => {
      const entries = await loadMemory('agent')
      expect(entries).toEqual([])
    })

    it('returns empty array for user when file does not exist', async () => {
      const entries = await loadMemory('user')
      expect(entries).toEqual([])
    })
  })

  describe('addEntry', () => {
    it('adds an entry to agent memory', async () => {
      const result = await addEntry('agent', 'Project uses Bun runtime')
      expect(result).toBe('Added to agent memory.')

      const entries = await loadMemory('agent')
      expect(entries).toEqual(['Project uses Bun runtime'])
    })

    it('adds an entry to user memory', async () => {
      const result = await addEntry('user', 'Prefers concise responses')
      expect(result).toBe('Added to user memory.')

      const entries = await loadMemory('user')
      expect(entries).toEqual(['Prefers concise responses'])
    })

    it('adds multiple entries', async () => {
      await addEntry('agent', 'First fact')
      await addEntry('agent', 'Second fact')

      const entries = await loadMemory('agent')
      expect(entries).toEqual(['First fact', 'Second fact'])
    })

    it('returns error when memory is full', async () => {
      const longContent = 'x'.repeat(1990)
      await addEntry('agent', longContent)

      const result = await addEntry('agent', 'This should not fit')
      expect(result).toBe('Memory full. Remove old entries first.')
    })
  })

  describe('replaceEntry', () => {
    it('replaces entry matching substring', async () => {
      await addEntry('agent', 'Uses TypeScript strict mode')
      await addEntry('agent', 'Database is PostgreSQL')

      const result = await replaceEntry('agent', 'PostgreSQL', 'Database is SQLite')
      expect(result).toBe('Replaced entry in agent memory.')

      const entries = await loadMemory('agent')
      expect(entries).toEqual(['Uses TypeScript strict mode', 'Database is SQLite'])
    })

    it('returns error when no match found', async () => {
      await addEntry('agent', 'Some entry')
      const result = await replaceEntry('agent', 'nonexistent', 'new content')
      expect(result).toBe('No entry matching "nonexistent" found.')
    })
  })

  describe('removeEntry', () => {
    it('removes entry matching substring', async () => {
      await addEntry('agent', 'Keep this')
      await addEntry('agent', 'Remove this one')

      const result = await removeEntry('agent', 'Remove this')
      expect(result).toBe('Removed entry from agent memory.')

      const entries = await loadMemory('agent')
      expect(entries).toEqual(['Keep this'])
    })

    it('returns error when no match found', async () => {
      const result = await removeEntry('agent', 'nothing')
      expect(result).toBe('No entry matching "nothing" found.')
    })
  })

  describe('getMemorySnapshot', () => {
    it('returns empty string when both stores are empty', async () => {
      const snapshot = await getMemorySnapshot()
      expect(snapshot).toBe('')
    })

    it('returns formatted snapshot with agent memory only', async () => {
      await addEntry('agent', 'Fact one')
      await addEntry('agent', 'Fact two')

      const snapshot = await getMemorySnapshot()
      expect(snapshot).toContain('## Agent Memory')
      expect(snapshot).toContain('- Fact one')
      expect(snapshot).toContain('- Fact two')
      expect(snapshot).not.toContain('## User Preferences')
    })

    it('returns formatted snapshot with both stores', async () => {
      await addEntry('agent', 'Project fact')
      await addEntry('user', 'User pref')

      const snapshot = await getMemorySnapshot()
      expect(snapshot).toContain('## Agent Memory')
      expect(snapshot).toContain('- Project fact')
      expect(snapshot).toContain('## User Preferences')
      expect(snapshot).toContain('- User pref')
    })
  })
})
