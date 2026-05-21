import { Cursor } from '../cursor/index.js'
import {
  pushToKillRing,
  getLastKill,
  resetKillAccumulation,
  recordYank,
} from '../cursor/index.js'

type KeyEvent = {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  option?: boolean
  raw?: string
}

type TextInputResult =
  | { type: 'cursor'; cursor: Cursor; killed?: string }
  | { type: 'action'; action: 'submit' | 'historyUp' | 'historyDown' | 'exit' }

type TextInputOptions = {
  multiline?: boolean
}

export function processTextInputKey(
  cursor: Cursor,
  key: KeyEvent,
  options?: TextInputOptions,
): TextInputResult {
  const isKill = key.ctrl && (key.name === 'k' || key.name === 'u' || key.name === 'w')
  if (!isKill) resetKillAccumulation()

  if (key.ctrl) {
    switch (key.name) {
      case 'a':
        return { type: 'cursor', cursor: cursor.startOfLine() }
      case 'e':
        return { type: 'cursor', cursor: cursor.endOfLine() }
      case 'b':
        return { type: 'cursor', cursor: cursor.left() }
      case 'f':
        return { type: 'cursor', cursor: cursor.right() }
      case 'k': {
        const next = cursor.deleteToLineEnd()
        pushToKillRing(next.killed, 'append')
        return { type: 'cursor', cursor: next.cursor, killed: next.killed }
      }
      case 'u': {
        const next = cursor.deleteToLineStart()
        pushToKillRing(next.killed, 'prepend')
        return { type: 'cursor', cursor: next.cursor, killed: next.killed }
      }
      case 'w': {
        const next = cursor.deleteWordBefore()
        pushToKillRing(next.killed, 'prepend')
        return { type: 'cursor', cursor: next.cursor, killed: next.killed }
      }
      case 'y': {
        const killed = getLastKill()
        if (!killed) return { type: 'cursor', cursor }
        const start = cursor.offset
        const next = cursor.insert(killed)
        recordYank(start, killed.length)
        return { type: 'cursor', cursor: next }
      }
    }
  }

  if (key.meta || key.option) {
    switch (key.name) {
      case 'b':
        return { type: 'cursor', cursor: cursor.prevWord() }
      case 'f':
        return { type: 'cursor', cursor: cursor.nextWord() }
      case 'd':
        return { type: 'cursor', cursor: cursor.deleteWordAfter() }
    }
  }

  switch (key.name) {
    case 'backspace':
      return { type: 'cursor', cursor: cursor.backspace() }
    case 'delete':
      return { type: 'cursor', cursor: cursor.del() }
    case 'left':
      return { type: 'cursor', cursor: cursor.left() }
    case 'right':
      return { type: 'cursor', cursor: cursor.right() }
    case 'home':
      return { type: 'cursor', cursor: cursor.startOfLine() }
    case 'end':
      return { type: 'cursor', cursor: cursor.endOfLine() }
    case 'up':
      return { type: 'action', action: 'historyUp' }
    case 'down':
      return { type: 'action', action: 'historyDown' }
    case 'return':
    case 'enter':
      if (options?.multiline && key.shift) {
        return { type: 'cursor', cursor: cursor.insert('\n') }
      }
      return { type: 'action', action: 'submit' }
  }

  if (key.raw && !key.ctrl && !key.meta) {
    return { type: 'cursor', cursor: cursor.insert(key.raw) }
  }

  return { type: 'cursor', cursor }
}
