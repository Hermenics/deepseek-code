import { describe, it, expect, beforeEach } from 'bun:test'

// Contract of the useInputBuffer logic, exercised through its hook-free factory createInputBuffer.
// State surviving re-renders is covered in hookPersistence.test.ts.
import { createInputBuffer } from '../../../src/ui/input/hooks/useInputBuffer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate calling the hook outside the React context.
 * The hook should be a pure function that returns UseInputBufferResult
 * (or allow direct calls in tests without renderHook).
 */
function createBuffer() {
  return createInputBuffer()
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useInputBuffer', () => {
  describe('push and undo', () => {
    it('should return the first entry when undo is called after two pushes', () => {
      const buf = createBuffer()

      buf.pushToBuffer('hello', 5)
      buf.pushToBuffer('world', 5)

      const entry = buf.undo()

      expect(entry).toBeDefined()
      expect(entry!.text).toBe('hello')
      expect(entry!.cursorOffset).toBe(5)
    })

    it('should return undefined when undo is called on empty buffer', () => {
      const buf = createBuffer()

      const entry = buf.undo()

      expect(entry).toBeUndefined()
    })

    it('should return undefined when undo is called with only one entry (nothing to go back to)', () => {
      const buf = createBuffer()

      buf.pushToBuffer('only', 4)

      const entry = buf.undo()

      expect(entry).toBeUndefined()
    })
  })

  describe('redo after undo', () => {
    it('should return the second entry when redo is called after push→push→undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()

      const entry = buf.redo()

      expect(entry).toBeDefined()
      expect(entry!.text).toBe('second')
      expect(entry!.cursorOffset).toBe(6)
    })

    it('should return undefined when redo is called without a prior undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('hello', 5)

      const entry = buf.redo()

      expect(entry).toBeUndefined()
    })
  })

  describe('canUndo and canRedo', () => {
    it('should have canUndo=false and canRedo=false on empty buffer', () => {
      const buf = createBuffer()

      expect(buf.canUndo).toBe(false)
      expect(buf.canRedo).toBe(false)
    })

    it('should have canUndo=false after single push (nothing to undo to)', () => {
      const buf = createBuffer()

      buf.pushToBuffer('only', 4)

      expect(buf.canUndo).toBe(false)
    })

    it('should have canUndo=true after two pushes', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)

      expect(buf.canUndo).toBe(true)
    })

    it('should have canRedo=true after push→push→undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()

      expect(buf.canRedo).toBe(true)
    })

    it('should have canRedo=false after push→push→undo→redo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()
      buf.redo()

      expect(buf.canRedo).toBe(false)
    })
  })

  describe('clearBuffer', () => {
    it('should reset canUndo and canRedo to false after clear', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.clearBuffer()

      expect(buf.canUndo).toBe(false)
      expect(buf.canRedo).toBe(false)
    })

    it('should return undefined for undo after clear', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.clearBuffer()

      expect(buf.undo()).toBeUndefined()
    })
  })

  describe('push after undo discards redo stack', () => {
    it('should make canRedo=false when a new push happens after undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()

      // A new entry discards the redo stack.
      buf.pushToBuffer('third', 5)

      expect(buf.canRedo).toBe(false)
    })

    it('should not be able to redo to "second" after push("third") following undo', () => {
      const buf = createBuffer()

      buf.pushToBuffer('first', 5)
      buf.pushToBuffer('second', 6)
      buf.undo()
      buf.pushToBuffer('third', 5)

      const entry = buf.redo()

      expect(entry).toBeUndefined()
    })
  })
})
