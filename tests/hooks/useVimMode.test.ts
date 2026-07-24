import { describe, it, expect, beforeEach } from 'bun:test'
import { Cursor } from '../../src/ui/input/cursor/index.js'
import { clearKillRing } from '../../src/ui/input/cursor/index.js'
import { processVimKey, processVimTextChunk, createVimState, type VimState } from '../../src/ui/input/hooks/useVimMode.js'

type KeyEvent = {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  raw?: string
}

function makeCursor(text: string, offset?: number): Cursor {
  return Cursor.fromText(text, 80, offset ?? 0)
}

function normalState(): VimState {
  return { ...createVimState(), mode: 'normal' }
}

function insertState(): VimState {
  return { ...createVimState(), mode: 'insert' }
}

function applyKeys(text: string, keys: string): Cursor {
  let cursor = makeCursor(text)
  let state = normalState()
  for (const raw of keys) {
    const result = processVimKey(cursor, { name: raw, raw }, state)
    if (result.type === 'cursor' || result.type === 'modeChange') cursor = result.cursor
    state = result.nextState ?? state
  }
  return cursor
}

describe('processVimKey', () => {
  beforeEach(() => {
    clearKillRing()
  })

  // ─── Normal mode — movement ────────────────────────────────────────────────

  describe('h — move left', () => {
    it('should move cursor one position to the left in normal mode', () => {
      const cursor = makeCursor('hello', 3)
      const result = processVimKey(cursor, { name: 'h', raw: 'h' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(2)
    })

    it('should be a no-op when cursor is at start', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'h', raw: 'h' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })
  })

  describe('l — move right', () => {
    it('should move cursor one position to the right in normal mode', () => {
      const cursor = makeCursor('hello', 1)
      const result = processVimKey(cursor, { name: 'l', raw: 'l' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(2)
    })

    it('should be a no-op when cursor is at end', () => {
      const cursor = makeCursor('hello', 5)
      const result = processVimKey(cursor, { name: 'l', raw: 'l' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(5)
    })
  })

  describe('0 — move to start of line', () => {
    it('should move cursor to offset 0', () => {
      const cursor = makeCursor('hello world', 7)
      const result = processVimKey(cursor, { name: '0', raw: '0' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(0)
    })
  })

  describe('$ — move to end of line', () => {
    it('should move cursor to end of text', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: '$', raw: '$' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBe(4)
    })
  })

  describe('w — move to next word', () => {
    it('should move cursor forward to the start of the next word', () => {
      const cursor = makeCursor('hello world', 0)
      const result = processVimKey(cursor, { name: 'w', raw: 'w' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBeGreaterThan(0)
    })
  })

  describe('b — move to previous word', () => {
    it('should move cursor backward to the start of the previous word', () => {
      const cursor = makeCursor('hello world', 11)
      const result = processVimKey(cursor, { name: 'b', raw: 'b' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.offset).toBeLessThan(11)
    })
  })

  // ─── Normal mode — editing ─────────────────────────────────────────────────

  describe('x — delete character under cursor', () => {
    it('should delete the character at the current cursor position', () => {
      const cursor = makeCursor('hello', 1)
      const result = processVimKey(cursor, { name: 'x', raw: 'x' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hllo')
      }
    })

    it('should be a no-op on empty text', () => {
      const cursor = makeCursor('', 0)
      const result = processVimKey(cursor, { name: 'x', raw: 'x' }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') expect(result.cursor.text).toBe('')
    })
  })

  describe('D — delete to end of line', () => {
    it('should delete from cursor to end of text', () => {
      const cursor = makeCursor('hello world', 5)
      const result = processVimKey(cursor, { name: 'D', raw: 'D', shift: true }, normalState())
      expect(result.type).toBe('cursor')
      if (result.type === 'cursor') {
        expect(result.cursor.text).toBe('hello')
      }
    })
  })

  describe('operator ranges', () => {
    it('d$ deletes through the last character', () => {
      expect(applyKeys('abc def', 'd$').text).toBe('')
    })

    it('df<char> includes the found character', () => {
      expect(applyKeys('abc5 def', 'df5').text).toBe(' def')
    })

    it('d3w preserves the operator count', () => {
      expect(applyKeys('one two three four', 'd3w').text).toBe('four')
    })
  })

  // ─── Normal mode — mode transitions ───────────────────────────────────────

  describe('i — enter insert mode', () => {
    it('should return modeChange to insert without moving cursor', () => {
      const cursor = makeCursor('hello', 2)
      const result = processVimKey(cursor, { name: 'i', raw: 'i' }, normalState())
      expect(result.type).toBe('modeChange')
      if (result.type === 'modeChange') {
        expect(result.mode).toBe('insert')
        expect(result.cursor.offset).toBe(2)
      }
    })
  })

  describe('a — move right then enter insert mode', () => {
    it('should advance cursor by one and switch to insert mode', () => {
      const cursor = makeCursor('hello', 2)
      const result = processVimKey(cursor, { name: 'a', raw: 'a' }, normalState())
      expect(result.type).toBe('modeChange')
      if (result.type === 'modeChange') {
        expect(result.mode).toBe('insert')
        expect(result.cursor.offset).toBe(3)
      }
    })
  })

  describe('I — move to start then enter insert mode', () => {
    it('should move cursor to offset 0 and switch to insert mode', () => {
      const cursor = makeCursor('hello', 4)
      const result = processVimKey(cursor, { name: 'I', raw: 'I', shift: true }, normalState())
      expect(result.type).toBe('modeChange')
      if (result.type === 'modeChange') {
        expect(result.mode).toBe('insert')
        expect(result.cursor.offset).toBe(0)
      }
    })
  })

  describe('A — move to end then enter insert mode', () => {
    it('should move cursor to end of text and switch to insert mode', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'A', raw: 'A', shift: true }, normalState())
      expect(result.type).toBe('modeChange')
      if (result.type === 'modeChange') {
        expect(result.mode).toBe('insert')
        expect(result.cursor.offset).toBe(5)
      }
    })
  })

  // ─── Normal mode — history / submit actions ────────────────────────────────

  describe('k — history up', () => {
    it('should return historyUp action in normal mode', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'k', raw: 'k' }, normalState())
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('historyUp')
    })
  })

  describe('j — history down', () => {
    it('should return historyDown action in normal mode', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'j', raw: 'j' }, normalState())
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('historyDown')
    })
  })

  describe('up arrow — history up in normal mode', () => {
    it('should return historyUp action', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'up' }, normalState())
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('historyUp')
    })
  })

  describe('down arrow — history down in normal mode', () => {
    it('should return historyDown action', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'down' }, normalState())
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('historyDown')
    })
  })

  describe('Enter — submit', () => {
    it('should return submit action in normal mode', () => {
      const cursor = makeCursor('hello', 0)
      const result = processVimKey(cursor, { name: 'return' }, normalState())
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('submit')
    })

    it('should return submit action in insert mode', () => {
      const cursor = makeCursor('hello', 5)
      const result = processVimKey(cursor, { name: 'return' }, insertState())
      expect(result.type).toBe('action')
      if (result.type === 'action') expect(result.action).toBe('submit')
    })
  })

  // ─── Insert mode — Escape transitions to normal ────────────────────────────

  describe('Escape in insert mode — switch to normal', () => {
    it('should return modeChange to normal mode', () => {
      const cursor = makeCursor('hello', 3)
      const result = processVimKey(cursor, { name: 'escape' }, insertState())
      expect(result.type).toBe('modeChange')
      if (result.type === 'modeChange') expect(result.mode).toBe('normal')
    })
  })

  // ─── Unmapped keys in normal mode ─────────────────────────────────────────

  describe('unmapped key in normal mode — noop', () => {
    it('should return noop for an unrecognised key', () => {
      const cursor = makeCursor('hello', 2)
      const result = processVimKey(cursor, { name: 'z', raw: 'z' }, normalState())
      expect(result.type).toBe('noop')
    })

    it('should not change cursor offset for an unrecognised key', () => {
      const cursor = makeCursor('hello', 2)
      const result = processVimKey(cursor, { name: 'q', raw: 'q' }, normalState())
      // noop means cursor is unchanged — either type noop or cursor with same offset
      if (result.type === 'cursor') {
        expect(result.cursor.offset).toBe(2)
      } else {
        expect(result.type).toBe('noop')
      }
    })
  })
})

describe('processVimTextChunk', () => {
  it('applies an operator and motion delivered in one terminal chunk', () => {
    const result = processVimTextChunk(makeCursor('one two'), 'dw', normalState())
    expect(result.cursor.text).toBe('two')
    expect(result.state.mode).toBe('normal')
  })

  it('enters insert mode and inserts the rest of the chunk', () => {
    const result = processVimTextChunk(makeCursor(''), 'ihello', normalState())
    expect(result.cursor.text).toBe('hello')
    expect(result.state.mode).toBe('insert')
  })

  it('propagates history actions so InputBox can handle them', () => {
    const result = processVimTextChunk(makeCursor('previous'), 'j', normalState())
    expect(result.action).toBe('historyDown')
  })
})
