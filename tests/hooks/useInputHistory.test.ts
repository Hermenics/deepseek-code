import { describe, it, expect, beforeEach } from 'bun:test'
import { InputHistory } from '../../src/ui/input/hooks/useInputHistory.js'

describe('InputHistory', () => {
  let history: InputHistory

  beforeEach(() => {
    history = new InputHistory()
  })

  // ─── up — navigate backwards ───────────────────────────────────────────────

  describe('up', () => {
    it('should return undefined when history is empty', () => {
      expect(history.up('current draft')).toBeUndefined()
    })

    it('should return the last history entry on first up press', () => {
      history.setHistory(['first', 'second', 'third'])
      const result = history.up('')
      expect(result).toBe('third')
    })

    it('should navigate backwards on consecutive up presses', () => {
      history.setHistory(['first', 'second', 'third'])
      history.up('')
      const result = history.up('')
      expect(result).toBe('second')
    })

    it('should stop at the oldest entry and return undefined when already there', () => {
      history.setHistory(['only'])
      history.up('') // navigates to 'only'
      const result = history.up('') // already at oldest
      expect(result).toBeUndefined()
    })

    it('should not advance past the first history entry', () => {
      history.setHistory(['a', 'b'])
      history.up('')  // → 'b'
      history.up('')  // → 'a'
      const result = history.up('') // already at oldest
      expect(result).toBeUndefined()
    })
  })

  // ─── down — navigate forwards ──────────────────────────────────────────────

  describe('down', () => {
    it('should return undefined when not navigating', () => {
      history.setHistory(['a', 'b'])
      expect(history.down()).toBeUndefined()
    })

    it('should return the next entry after navigating up twice', () => {
      history.setHistory(['first', 'second', 'third'])
      history.up('') // → 'third'
      history.up('') // → 'second'
      const result = history.down()
      expect(result).toBe('third')
    })

    it('should restore the saved draft when navigating back to the present', () => {
      history.setHistory(['old entry'])
      history.up('my draft') // saves 'my draft', shows 'old entry'
      const result = history.down()
      expect(result).toBe('my draft')
    })

    it('should return undefined after restoring draft (no more forward entries)', () => {
      history.setHistory(['old entry'])
      history.up('my draft')
      history.down() // restores draft
      expect(history.down()).toBeUndefined()
    })
  })

  // ─── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should stop navigation and clear position', () => {
      history.setHistory(['a', 'b', 'c'])
      history.up('')
      history.reset()
      expect(history.isNavigating).toBe(false)
    })

    it('should make up start from the end of history again after reset', () => {
      history.setHistory(['first', 'second', 'third'])
      history.up('')  // → 'third'
      history.up('')  // → 'second'
      history.reset()
      const result = history.up('')
      expect(result).toBe('third')
    })

    it('should make down return undefined after reset', () => {
      history.setHistory(['a', 'b'])
      history.up('')
      history.reset()
      expect(history.down()).toBeUndefined()
    })
  })

  // ─── setHistory ────────────────────────────────────────────────────────────

  describe('setHistory', () => {
    it('should replace the current history entries', () => {
      history.setHistory(['old'])
      history.setHistory(['new1', 'new2'])
      const result = history.up('')
      expect(result).toBe('new2')
    })

    it('should handle an empty array without throwing', () => {
      history.setHistory([])
      expect(history.up('')).toBeUndefined()
    })

    it('should reset navigation position when history is replaced', () => {
      history.setHistory(['a', 'b', 'c'])
      history.up('') // → 'c'
      history.setHistory(['x', 'y'])
      // After replacing history, navigation should restart from the end
      const result = history.up('')
      expect(result).toBe('y')
    })
  })

  // ─── isNavigating ──────────────────────────────────────────────────────────

  describe('isNavigating', () => {
    it('should be false initially', () => {
      expect(history.isNavigating).toBe(false)
    })

    it('should be true after the first up press', () => {
      history.setHistory(['a'])
      history.up('')
      expect(history.isNavigating).toBe(true)
    })

    it('should be false after reset', () => {
      history.setHistory(['a'])
      history.up('')
      history.reset()
      expect(history.isNavigating).toBe(false)
    })

    it('should be false after navigating back to the draft with down', () => {
      history.setHistory(['a'])
      history.up('draft')
      history.down() // restores draft
      expect(history.isNavigating).toBe(false)
    })
  })

  // ─── draft preservation ────────────────────────────────────────────────────

  describe('draft preservation', () => {
    it('should save the draft on the first up press', () => {
      history.setHistory(['old'])
      history.up('my current draft')
      const restored = history.down()
      expect(restored).toBe('my current draft')
    })

    it('should not overwrite the saved draft on subsequent up presses', () => {
      history.setHistory(['a', 'b', 'c'])
      history.up('original draft') // saves 'original draft', shows 'c'
      history.up('c')              // navigates further back, shows 'b'
      history.down()               // shows 'c'
      const restored = history.down()
      expect(restored).toBe('original draft')
    })

    it('should save an empty string as draft when input is empty', () => {
      history.setHistory(['a'])
      history.up('')
      const restored = history.down()
      expect(restored).toBe('')
    })
  })
})
