import { describe, it, expect, beforeEach } from 'bun:test'
import { Cursor } from '../../src/ui/input/cursor/index.js'
import { clearKillRing, pushToKillRing } from '../../src/ui/input/cursor/index.js'
import { processTextInputKey } from '../../src/ui/input/hooks/useTextInput.js'

type KeyEvent = {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  option?: boolean
  raw?: string
}

function makeCursor(text: string, offset?: number): Cursor {
  return Cursor.fromText(text, 80, offset ?? 0)
}

describe('processTextInputKey', () => {
  beforeEach(() => {
    clearKillRing()
  })

  // ─── Emacs movement ───────────────────────────────────────────────────────

  describe('Ctrl+A — move to start of line', () => {
    it('should move cursor to offset 0 when in the middle of text', () => {
      const cursor = makeCursor('hello world', 6)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'a' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })

    it('should be a no-op when cursor is already at start', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'a' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })
  })

  describe('Ctrl+E — move to end of line', () => {
    it('should move cursor to end of text', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'e' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(5)
    })

    it('should be a no-op when cursor is already at end', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'e' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(5)
    })
  })

  describe('Ctrl+B — move left one character', () => {
    it('should move cursor one position to the left', () => {
      const cursor = makeCursor('hello', 3)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'b' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(2)
    })

    it('should be a no-op at start of text', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'b' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })
  })

  describe('Ctrl+F — move right one character', () => {
    it('should move cursor one position to the right', () => {
      const cursor = makeCursor('hello', 2)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'f' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(3)
    })

    it('should be a no-op at end of text', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'f' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(5)
    })
  })

  // ─── Kill commands ─────────────────────────────────────────────────────────

  describe('Ctrl+K — kill to end of line', () => {
    it('should delete text from cursor to end and return killed text', () => {
      const cursor = makeCursor('hello world', 5)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'k' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello')
        expect(result.killed).toBe(' world')
      }
    })

    it('should return empty killed string when cursor is at end', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'k' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello')
        expect(result.killed).toBe('')
      }
    })
  })

  describe('Ctrl+U — kill to start of line', () => {
    it('should delete text from start to cursor and return killed text', () => {
      const cursor = makeCursor('hello world', 5)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'u' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe(' world')
        expect(result.killed).toBe('hello')
      }
    })

    it('should return empty killed string when cursor is at start', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'u' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.killed).toBe('')
      }
    })
  })

  describe('Ctrl+W — kill word before cursor', () => {
    it('should delete the word immediately before the cursor', () => {
      const cursor = makeCursor('hello world', 11)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'w' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello ')
        expect(result.killed).toBe('world')
      }
    })

    it('should return empty killed string when cursor is at start', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'w' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.killed).toBe('')
      }
    })
  })

  describe('Ctrl+Y — yank from kill ring', () => {
    it('should insert the last killed text at cursor position', () => {
      pushToKillRing('world')
      const cursor = makeCursor('hello ', 6)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'y' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello world')
        expect(result.cursor.offset).toBe(11)
      }
    })

    it('should be a no-op when kill ring is empty', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { ctrl: true, name: 'y' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello')
      }
    })
  })

  // ─── Word movement ─────────────────────────────────────────────────────────

  describe('Alt+B — move to previous word', () => {
    it('should move cursor to the start of the previous word', () => {
      const cursor = makeCursor('hello world', 11)
      const result = processTextInputKey(cursor, { meta: true, name: 'b' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBeLessThan(11)
    })

    it('should be a no-op at start of text', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { meta: true, name: 'b' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })
  })

  describe('Alt+F — move to next word', () => {
    it('should move cursor to the start of the next word', () => {
      const cursor = makeCursor('hello world', 0)
      const result = processTextInputKey(cursor, { meta: true, name: 'f' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBeGreaterThan(0)
    })

    it('should be a no-op at end of text', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { meta: true, name: 'f' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(5)
    })
  })

  describe('Alt+D — delete next word', () => {
    it('should delete the word after the cursor', () => {
      const cursor = makeCursor('hello world', 6)
      const result = processTextInputKey(cursor, { meta: true, name: 'd' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello ')
      }
    })

    it('should be a no-op at end of text', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { meta: true, name: 'd' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.text).toBe('hello')
    })
  })

  // ─── Basic editing ─────────────────────────────────────────────────────────

  describe('Backspace — delete grapheme before cursor', () => {
    it('should delete the character immediately before the cursor', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { name: 'backspace' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hell')
        expect(result.cursor.offset).toBe(4)
      }
    })

    it('should be a no-op at start of text', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { name: 'backspace' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.text).toBe('hello')
    })
  })

  describe('Delete — delete grapheme at cursor', () => {
    it('should delete the character at the cursor position', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { name: 'delete' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('ello')
        expect(result.cursor.offset).toBe(0)
      }
    })

    it('should be a no-op at end of text', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { name: 'delete' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.text).toBe('hello')
    })
  })

  // ─── Arrow keys ────────────────────────────────────────────────────────────

  describe('Left arrow — move cursor left', () => {
    it('should move cursor one position to the left', () => {
      const cursor = makeCursor('hello', 3)
      const result = processTextInputKey(cursor, { name: 'left' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(2)
    })
  })

  describe('Right arrow — move cursor right', () => {
    it('should move cursor one position to the right', () => {
      const cursor = makeCursor('hello', 2)
      const result = processTextInputKey(cursor, { name: 'right' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(3)
    })
  })

  describe('Home — move to start of line', () => {
    it('should move cursor to offset 0', () => {
      const cursor = makeCursor('hello', 4)
      const result = processTextInputKey(cursor, { name: 'home' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })
  })

  describe('End — move to end of line', () => {
    it('should move cursor to end of text', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { name: 'end' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(5)
    })
  })

  // ─── Printable character insertion ────────────────────────────────────────

  describe('printable character — insert at cursor', () => {
    it('should insert a character at the current cursor position', () => {
      const cursor = makeCursor('hllo', 1)
      const result = processTextInputKey(cursor, { name: 'e', raw: 'e' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello')
        expect(result.cursor.offset).toBe(2)
      }
    })

    it('should append a character when cursor is at end', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { name: '!', raw: '!' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello!')
      }
    })

    it('should insert a multi-byte unicode character correctly', () => {
      const cursor = makeCursor('hi', 2)
      const result = processTextInputKey(cursor, { name: '🎉', raw: '🎉' })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hi🎉')
      }
    })
  })

  // ─── Submit / history actions ──────────────────────────────────────────────

  describe('Enter — submit', () => {
    it('should return action submit when Enter is pressed in single-line mode', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { name: 'return' })
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('submit')
    })
  })

  describe('Shift+Enter — insert newline in multiline mode', () => {
    it('should insert a newline character when multiline is enabled', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { name: 'return', shift: true }, { multiline: true })
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello\n')
      }
    })
  })

  describe('Up arrow — history navigation', () => {
    it('should return historyUp action when cursor is on the first line', () => {
      const cursor = makeCursor('hello', 0)
      const result = processTextInputKey(cursor, { name: 'up' })
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('historyUp')
    })
  })

  describe('Down arrow — history navigation', () => {
    it('should return historyDown action when cursor is on the last line', () => {
      const cursor = makeCursor('hello', 5)
      const result = processTextInputKey(cursor, { name: 'down' })
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('historyDown')
    })
  })
})
