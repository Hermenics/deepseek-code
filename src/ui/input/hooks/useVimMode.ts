import { Cursor } from '../cursor/index.js'

type KeyEvent = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; raw?: string }
type VimMode = 'insert' | 'normal'
export type VimState = { mode: VimMode }

type VimResult =
  | { type: 'cursor'; cursor: Cursor }
  | { type: 'modeChange'; mode: VimMode; cursor: Cursor }
  | { type: 'action'; action: 'submit' | 'historyUp' | 'historyDown' }
  | { type: 'noop' }

export function processVimKey(cursor: Cursor, key: KeyEvent, state: VimState): VimResult {
  if (state.mode === 'insert') {
    if (key.name === 'escape') return { type: 'modeChange', mode: 'normal', cursor }
    if (key.name === 'return' || key.name === 'enter') return { type: 'action', action: 'submit' }
    return { type: 'noop' }
  }

  switch (key.name) {
    case 'h':
    case 'left':
      return { type: 'cursor', cursor: cursor.left() }
    case 'l':
    case 'right':
      return { type: 'cursor', cursor: cursor.right() }
    case '0':
    case 'home':
      return { type: 'cursor', cursor: cursor.startOfLine() }
    case '$':
    case 'end':
      return { type: 'cursor', cursor: cursor.endOfLine() }
    case 'w':
      return { type: 'cursor', cursor: cursor.nextWord() }
    case 'b':
      return { type: 'cursor', cursor: cursor.prevWord() }
    case 'x':
      return { type: 'cursor', cursor: cursor.del() }
    case 'D':
      return { type: 'cursor', cursor: cursor.deleteToLineEnd().cursor }
    case 'i':
      return { type: 'modeChange', mode: 'insert', cursor }
    case 'a':
      return { type: 'modeChange', mode: 'insert', cursor: cursor.right() }
    case 'I':
      return { type: 'modeChange', mode: 'insert', cursor: cursor.startOfLine() }
    case 'A':
      return { type: 'modeChange', mode: 'insert', cursor: cursor.endOfLine() }
    case 'k':
    case 'up':
      return { type: 'action', action: 'historyUp' }
    case 'j':
    case 'down':
      return { type: 'action', action: 'historyDown' }
    case 'return':
    case 'enter':
      return { type: 'action', action: 'submit' }
    default:
      return { type: 'noop' }
  }
}
