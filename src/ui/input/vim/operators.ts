import type { Operator, VimState } from './types.js'

export interface OperatorResult {
  text: string
  cursor: number
  register: string
  enterInsert: boolean
}

export function applyOperator(
  op: Operator,
  text: string,
  start: number,
  end: number,
  _state: VimState
): OperatorResult {
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const yanked = text.slice(lo, hi)

  if (op === 'y') {
    return { text, cursor: lo, register: yanked, enterInsert: false }
  }

  // d and c both delete
  const newText = text.slice(0, lo) + text.slice(hi)
  const cursor = Math.min(lo, Math.max(0, newText.length - 1))

  return {
    text: newText,
    cursor,
    register: yanked,
    enterInsert: op === 'c',
  }
}

// dd / cc / yy — operate on full line content
export function applyLineOperator(
  op: Operator,
  text: string,
  cursor: number,
  _state: VimState
): OperatorResult {
  // Find line boundaries
  let lineStart = cursor
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--
  let lineEnd = cursor
  while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++

  const yanked = text.slice(lineStart, lineEnd)

  if (op === 'y') {
    return { text, cursor: lineStart, register: yanked, enterInsert: false }
  }

  const newText = text.slice(0, lineStart) + text.slice(lineEnd)
  const newCursor = Math.min(lineStart, Math.max(0, newText.length - 1))

  return {
    text: newText,
    cursor: newCursor,
    register: yanked,
    enterInsert: op === 'c',
  }
}
