import { Cursor } from '../cursor/index.js'
import type { Operator, VimMode, VimState } from '../vim/types.js'
import { getMotion, getMotionRange } from '../vim/motions.js'
import { applyOperator, applyLineOperator } from '../vim/operators.js'
import { getTextObject } from '../vim/textObjects.js'

type KeyEvent = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; raw?: string }
export type { VimState }

type VimResult =
  | { type: 'cursor'; cursor: Cursor }
  | { type: 'modeChange'; mode: VimMode; cursor: Cursor }
  | { type: 'action'; action: 'submit' | 'historyUp' | 'historyDown' }
  | { type: 'noop' }

export function createVimState(): VimState {
  return { mode: 'insert', pendingOperator: null, register: '', count: null, pendingKey: null, textObjectModifier: null }
}

function keyName(key: KeyEvent): string {
  if (key.raw && key.raw.length === 1) return key.raw
  return key.name ?? ''
}

function applyCount(n: number | null, fn: () => Cursor, cursor: Cursor): Cursor {
  let c = cursor
  const times = n ?? 1
  for (let i = 0; i < times; i++) c = fn.call(null)
  // fn needs to use the updated cursor each time, so we need a different approach
  return c
}

// Cursor factory helpers that work with raw text+offset
function cursorWith(base: Cursor, text: string, offset: number): Cursor {
  const cols = (base as any).measuredText?.columns ?? 79
  return Cursor.fromText(text, cols + 1, offset)
}

export function processVimKey(cursor: Cursor, key: KeyEvent, state: VimState): VimResult & { nextState?: VimState } {
  const k = keyName(key)

  // Insert mode — only escape and enter are intercepted
  if (state.mode === 'insert') {
    if (k === 'escape') {
      const newCursor = cursor.offset > 0 ? cursor.left() : cursor
      return { type: 'modeChange', mode: 'normal', cursor: newCursor, nextState: { ...state, mode: 'normal', pendingKey: null, pendingOperator: null, count: null, textObjectModifier: null } }
    }
    if (k === 'return' || k === 'enter') return { type: 'action', action: 'submit' }
    return { type: 'noop' }
  }

  // Normal mode — count accumulation
  if (state.mode === 'normal') {
    // Accumulate numeric count (0 only after another digit)
    if (/^[1-9]$/.test(k) || (k === '0' && (state.count ?? null) !== null)) {
      const digit = parseInt(k, 10)
      const newCount = (state.count ?? null) === null ? digit : state.count! * 10 + digit
      return { type: 'noop', nextState: { ...state, count: newCount } } as any
    }

    // History navigation
    if (k === 'k' || k === 'up') return { type: 'action', action: 'historyUp' }
    if (k === 'j' || k === 'down') return { type: 'action', action: 'historyDown' }
    if (k === 'return' || k === 'enter') return { type: 'action', action: 'submit' }

    // Two-key sequence: second key pending
    if (state.pendingKey === 'f' || state.pendingKey === 't' || state.pendingKey === 'g') {
      const motionFn = getMotion(k, state.pendingKey)
      const reset = { ...state, pendingKey: null, count: null }
      if (motionFn) {
        const times = state.count ?? 1
        let offset = cursor.offset
        for (let i = 0; i < times; i++) {
          const [next] = motionFn(cursor.text, offset)
          offset = next
        }
        const newCursor = Cursor.fromText(cursor.text, (cursor as any).measuredText.columns + 1, offset)
        return { type: 'cursor', cursor: newCursor, nextState: reset } as any
      }
      return { type: 'noop', nextState: reset } as any
    }

    // Operators
    if (k === 'd' || k === 'c' || k === 'y') {
      const op = k as Operator
      // dd / cc / yy
      if (state.pendingOperator === op) {
        const result = applyLineOperator(op, cursor.text, cursor.offset, state)
        const newCursor = Cursor.fromText(result.text, (cursor as any).measuredText.columns + 1, result.cursor)
        const reset = { ...state, pendingOperator: null, count: null }
        if (result.enterInsert) {
          return { type: 'modeChange', mode: 'insert', cursor: newCursor, nextState: { ...reset, mode: 'insert', register: result.register } } as any
        }
        return { type: 'cursor', cursor: newCursor, nextState: { ...reset, register: result.register } } as any
      }
      return { type: 'noop', nextState: { ...state, pendingOperator: op, count: null } } as any
    }

    // Enter insert mode commands
    if (k === 'i') return { type: 'modeChange', mode: 'insert', cursor, nextState: { ...state, mode: 'insert', pendingOperator: null, count: null } }
    if (k === 'a') return { type: 'modeChange', mode: 'insert', cursor: cursor.right(), nextState: { ...state, mode: 'insert', pendingOperator: null, count: null } }
    if (k === 'I') return { type: 'modeChange', mode: 'insert', cursor: cursor.startOfLine(), nextState: { ...state, mode: 'insert', pendingOperator: null, count: null } }
    if (k === 'A') return { type: 'modeChange', mode: 'insert', cursor: cursor.endOfLine(), nextState: { ...state, mode: 'insert', pendingOperator: null, count: null } }
    if (k === 'o') {
      const eol = cursor.endOfLine()
      const newCursor = eol.insert('\n')
      return { type: 'modeChange', mode: 'insert', cursor: newCursor, nextState: { ...state, mode: 'insert', pendingOperator: null, count: null } }
    }

    // Simple delete commands
    if (k === 'x') {
      const times = state.count ?? 1
      let c = cursor
      for (let i = 0; i < times; i++) c = c.del()
      return { type: 'cursor', cursor: c, nextState: { ...state, count: null } }
    }
    if (k === 'D') return { type: 'cursor', cursor: cursor.deleteToLineEnd().cursor, nextState: { ...state, count: null } }

    // Paste
    if (k === 'p' && state.register) {
      const newCursor = cursor.right().insert(state.register)
      return { type: 'cursor', cursor: newCursor, nextState: { ...state, count: null } }
    }
    if (k === 'P' && state.register) {
      const newCursor = cursor.insert(state.register)
      return { type: 'cursor', cursor: newCursor, nextState: { ...state, count: null } }
    }

    // Start two-key sequences
    if (k === 'f' || k === 't' || k === 'g') {
      return { type: 'noop', nextState: { ...state, pendingKey: k, count: state.count } } as any
    }

    // Motions
    const motionFn = getMotion(k)
    if (motionFn) {
      const times = state.count ?? 1
      let offset = cursor.offset
      for (let i = 0; i < times; i++) {
        const [next] = motionFn(cursor.text, offset)
        offset = next
      }
      const newCursor = Cursor.fromText(cursor.text, (cursor as any).measuredText.columns + 1, offset)
      return { type: 'cursor', cursor: newCursor, nextState: { ...state, count: null } }
    }

    return { type: 'noop', nextState: { ...state, count: null } } as any
  }

  // Operator-pending mode
  if (state.mode === 'operator-pending') {
    const op = state.pendingOperator!
    const reset = { ...state, mode: 'normal' as VimMode, pendingOperator: null, count: null, textObjectModifier: null }

    // Detect text object modifier: i or a
    if ((k === 'i' || k === 'a') && !state.textObjectModifier) {
      return { type: 'noop', nextState: { ...state, textObjectModifier: k } } as any
    }

    // Text object
    if (state.textObjectModifier) {
      const toFn = getTextObject(k, state.textObjectModifier)
      if (toFn) {
        const [start, end] = toFn(cursor.text, cursor.offset)
        const result = applyOperator(op, cursor.text, start, end, state)
        const newCursor = Cursor.fromText(result.text, (cursor as any).measuredText.columns + 1, result.cursor)
        if (result.enterInsert) {
          return { type: 'modeChange', mode: 'insert', cursor: newCursor, nextState: { ...reset, mode: 'insert', register: result.register } } as any
        }
        return { type: 'cursor', cursor: newCursor, nextState: { ...reset, register: result.register } } as any
      }
      return { type: 'noop', nextState: reset } as any
    }

    // Repeated operator: dd/cc/yy
    if (k === (op as string)) {
      const result = applyLineOperator(op, cursor.text, cursor.offset, state)
      const newCursor = Cursor.fromText(result.text, (cursor as any).measuredText.columns + 1, result.cursor)
      if (result.enterInsert) {
        return { type: 'modeChange', mode: 'insert', cursor: newCursor, nextState: { ...reset, mode: 'insert', register: result.register } } as any
      }
      return { type: 'cursor', cursor: newCursor, nextState: { ...reset, register: result.register } } as any
    }

    // Two-key motion (f/t/g pending)
    if (state.pendingKey === 'f' || state.pendingKey === 't' || state.pendingKey === 'g') {
      const motionFn = getMotion(k, state.pendingKey)
      if (motionFn) {
        const [start, end] = getMotionRange(motionFn, cursor.text, cursor.offset)
        const result = applyOperator(op, cursor.text, start, end, state)
        const newCursor = Cursor.fromText(result.text, (cursor as any).measuredText.columns + 1, result.cursor)
        if (result.enterInsert) {
          return { type: 'modeChange', mode: 'insert', cursor: newCursor, nextState: { ...reset, mode: 'insert', register: result.register } } as any
        }
        return { type: 'cursor', cursor: newCursor, nextState: { ...reset, register: result.register } } as any
      }
      return { type: 'noop', nextState: { ...reset, pendingKey: null } } as any
    }

    if (k === 'f' || k === 't' || k === 'g') {
      return { type: 'noop', nextState: { ...state, pendingKey: k } } as any
    }

    // Motion
    const motionFn = getMotion(k)
    if (motionFn) {
      const [start, end] = getMotionRange(motionFn, cursor.text, cursor.offset)
      const result = applyOperator(op, cursor.text, start, end, state)
      const newCursor = Cursor.fromText(result.text, (cursor as any).measuredText.columns + 1, result.cursor)
      if (result.enterInsert) {
        return { type: 'modeChange', mode: 'insert', cursor: newCursor, nextState: { ...reset, mode: 'insert', register: result.register } } as any
      }
      return { type: 'cursor', cursor: newCursor, nextState: { ...reset, register: result.register } } as any
    }

    // Escape cancels
    if (k === 'escape') return { type: 'noop', nextState: reset } as any

    return { type: 'noop', nextState: reset } as any
  }

  return { type: 'noop' }
}
