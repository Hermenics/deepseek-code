import { describe, it, expect, beforeEach } from 'bun:test'
import { InputBuffer } from '../../src/ui/input/hooks/useInputBuffer.js'

describe('InputBuffer', () => {
  let buffer: InputBuffer

  beforeEach(() => {
    buffer = new InputBuffer()
  })

  // ─── push ──────────────────────────────────────────────────────────────────

  describe('push', () => {
    it('should add an entry to the buffer', () => {
      buffer.push('hello', 5)
      expect(buffer.canUndo).toBe(false) // first entry — nothing to undo to
    })

    it('should record text and cursorOffset in the entry', () => {
      buffer.push('hello', 3)
      buffer.push('hello world', 11)
      const entry = buffer.undo()
      expect(entry).toBeDefined()
      if (entry) {
        expect(entry.text).toBe('hello')
        expect(entry.cursorOffset).toBe(3)
      }
    })

    it('should record a timestamp on each entry', () => {
      const before = Date.now()
      buffer.push('hello', 5)
      buffer.push('hello world', 11)
      const entry = buffer.undo()
      expect(entry).toBeDefined()
      if (entry) {
        expect(entry.timestamp).toBeGreaterThanOrEqual(before)
      }
    })
  })

  // ─── undo ──────────────────────────────────────────────────────────────────

  describe('undo', () => {
    it('should return undefined when buffer is empty', () => {
      expect(buffer.undo()).toBeUndefined()
    })

    it('should return undefined when only one entry exists (nothing to undo to)', () => {
      buffer.push('hello', 5)
      expect(buffer.undo()).toBeUndefined()
    })

    it('should return the previous entry after two pushes', () => {
      buffer.push('hello', 5)
      buffer.push('hello world', 11)
      const entry = buffer.undo()
      expect(entry).toBeDefined()
      if (entry) expect(entry.text).toBe('hello')
    })

    it('should navigate backwards through multiple entries', () => {
      buffer.push('a', 1)
      buffer.push('ab', 2)
      buffer.push('abc', 3)

      const second = buffer.undo()
      expect(second?.text).toBe('ab')

      const first = buffer.undo()
      expect(first?.text).toBe('a')
    })

    it('should stop at the oldest entry and not go further', () => {
      buffer.push('a', 1)
      buffer.push('b', 1)

      buffer.undo() // back to 'a'
      const result = buffer.undo() // already at oldest
      expect(result).toBeUndefined()
    })
  })

  // ─── redo ──────────────────────────────────────────────────────────────────

  describe('redo', () => {
    it('should return undefined when at the latest entry', () => {
      buffer.push('hello', 5)
      expect(buffer.redo()).toBeUndefined()
    })

    it('should return the next entry after an undo', () => {
      buffer.push('hello', 5)
      buffer.push('hello world', 11)
      buffer.undo()
      const entry = buffer.redo()
      expect(entry).toBeDefined()
      if (entry) expect(entry.text).toBe('hello world')
    })

    it('should navigate forward through multiple entries after undo', () => {
      buffer.push('a', 1)
      buffer.push('ab', 2)
      buffer.push('abc', 3)

      buffer.undo() // → 'ab'
      buffer.undo() // → 'a'

      const redoFirst = buffer.redo()
      expect(redoFirst?.text).toBe('ab')

      const redoSecond = buffer.redo()
      expect(redoSecond?.text).toBe('abc')
    })

    it('should return undefined when redo is called without a prior undo', () => {
      buffer.push('hello', 5)
      buffer.push('world', 5)
      expect(buffer.redo()).toBeUndefined()
    })
  })

  // ─── push after undo (fork) ────────────────────────────────────────────────

  describe('push after undo — fork discards future entries', () => {
    it('should discard entries ahead of current position when a new push occurs', () => {
      buffer.push('a', 1)
      buffer.push('ab', 2)
      buffer.push('abc', 3)

      buffer.undo() // back to 'ab'
      buffer.push('abX', 3) // fork: 'abc' is discarded

      // redo should now be unavailable (no future entries)
      expect(buffer.redo()).toBeUndefined()
    })

    it('should allow undoing back to the entry before the fork', () => {
      buffer.push('a', 1)
      buffer.push('ab', 2)
      buffer.undo() // back to 'a'
      buffer.push('aZ', 2) // fork

      const entry = buffer.undo()
      expect(entry?.text).toBe('a')
    })
  })

  // ─── maxSize ───────────────────────────────────────────────────────────────

  describe('maxSize — oldest entries are discarded', () => {
    it('should not exceed the configured maxSize', () => {
      const small = new InputBuffer({ maxSize: 3 })
      small.push('a', 1)
      small.push('b', 1)
      small.push('c', 1)
      small.push('d', 1) // 'a' should be evicted

      // Navigate all the way back — should reach 'b', not 'a'
      small.undo() // → 'c'
      small.undo() // → 'b'
      const oldest = small.undo()
      // Either undefined (b is the oldest) or 'b' is the oldest reachable
      if (oldest !== undefined) {
        expect(oldest.text).not.toBe('a')
      }
    })

    it('should default to a reasonable maxSize when not specified', () => {
      const defaultBuffer = new InputBuffer()
      // Push more than a minimal buffer would hold
      for (let i = 0; i < 20; i++) {
        defaultBuffer.push(`entry-${i}`, i)
      }
      // Should not throw and canUndo should be true
      expect(defaultBuffer.canUndo).toBe(true)
    })
  })

  // ─── canUndo ───────────────────────────────────────────────────────────────

  describe('canUndo', () => {
    it('should return false when buffer is empty', () => {
      expect(buffer.canUndo).toBe(false)
    })

    it('should return false when only one entry exists', () => {
      buffer.push('hello', 5)
      expect(buffer.canUndo).toBe(false)
    })

    it('should return true when there are at least two entries', () => {
      buffer.push('hello', 5)
      buffer.push('hello world', 11)
      expect(buffer.canUndo).toBe(true)
    })

    it('should return false after undoing to the oldest entry', () => {
      buffer.push('a', 1)
      buffer.push('b', 1)
      buffer.undo()
      expect(buffer.canUndo).toBe(false)
    })
  })

  // ─── canRedo ───────────────────────────────────────────────────────────────

  describe('canRedo', () => {
    it('should return false when at the latest entry', () => {
      buffer.push('hello', 5)
      expect(buffer.canRedo).toBe(false)
    })

    it('should return true after an undo', () => {
      buffer.push('hello', 5)
      buffer.push('hello world', 11)
      buffer.undo()
      expect(buffer.canRedo).toBe(true)
    })

    it('should return false after redoing to the latest entry', () => {
      buffer.push('a', 1)
      buffer.push('b', 1)
      buffer.undo()
      buffer.redo()
      expect(buffer.canRedo).toBe(false)
    })
  })

  // ─── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('should empty the buffer', () => {
      buffer.push('hello', 5)
      buffer.push('world', 5)
      buffer.clear()
      expect(buffer.canUndo).toBe(false)
      expect(buffer.canRedo).toBe(false)
    })

    it('should make undo return undefined after clearing', () => {
      buffer.push('hello', 5)
      buffer.push('world', 5)
      buffer.clear()
      expect(buffer.undo()).toBeUndefined()
    })

    it('should allow pushing new entries after clearing', () => {
      buffer.push('hello', 5)
      buffer.clear()
      buffer.push('fresh', 5)
      buffer.push('fresh start', 11)
      expect(buffer.canUndo).toBe(true)
    })
  })
})
