import { Cursor } from '../cursor/index.js'
import {
  pushToKillRing,
  getLastKill,
  resetKillAccumulation,
  recordYank,
} from '../cursor/index.js'
import type { KeybindingsSettings } from '../../../settings/types.js'
import { resolveKeybindingAction, resolveKeybindings } from '../keybindings.js'

export type KeyEvent = {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  option?: boolean
  raw?: string
  sequence?: string
}

export interface UseTextInputProps {
  value: string
  onChange: (value: string) => void
  cursorOffset: number
  onChangeCursorOffset: (offset: number) => void
  onSubmit?: (value: string) => void
  onHistoryUp?: () => void
  onHistoryDown?: () => void
  multiline?: boolean
  columns: number
  keybindings?: KeybindingsSettings
}

export interface BaseInputState {
  onKeyEvent: (key: KeyEvent) => void
  renderedValue: string
  offset: number
  cursorLine: number
  cursorColumn: number
}

type TextInputResult =
  | { type: 'cursor'; cursor: Cursor; killed?: string }
  | { type: 'action'; action: 'submit' | 'historyUp' | 'historyDown' | 'exit' }

type TextInputOptions = {
  multiline?: boolean
  keybindings?: KeybindingsSettings
}

export function processTextInputKey(
  cursor: Cursor,
  key: KeyEvent,
  options?: TextInputOptions,
): TextInputResult {
  const action = resolveKeybindingAction(key, options?.keybindings ? resolveKeybindings(options.keybindings) : undefined)
  const isKill = action === 'killToEnd' || action === 'killToStart' || action === 'killWordBackward'
  if (!isKill) resetKillAccumulation()

  switch (action) {
    case 'cursorStart':
      return { type: 'cursor', cursor: cursor.startOfLine() }
    case 'cursorEnd':
      return { type: 'cursor', cursor: cursor.endOfLine() }
    case 'cursorLeft':
      return { type: 'cursor', cursor: cursor.left() }
    case 'cursorRight':
      return { type: 'cursor', cursor: cursor.right() }
    case 'cursorWordLeft':
      return { type: 'cursor', cursor: cursor.prevWord() }
    case 'cursorWordRight':
      return { type: 'cursor', cursor: cursor.nextWord() }
    case 'killToEnd': {
        const next = cursor.deleteToLineEnd()
        pushToKillRing(next.killed, 'append')
        return { type: 'cursor', cursor: next.cursor, killed: next.killed }
    }
    case 'killToStart': {
        const next = cursor.deleteToLineStart()
        pushToKillRing(next.killed, 'prepend')
        return { type: 'cursor', cursor: next.cursor, killed: next.killed }
    }
    case 'killWordBackward': {
        const next = cursor.deleteWordBefore()
        pushToKillRing(next.killed, 'prepend')
        return { type: 'cursor', cursor: next.cursor, killed: next.killed }
    }
    case 'yank': {
        const killed = getLastKill()
        if (!killed) return { type: 'cursor', cursor }
        const start = cursor.offset
        const next = cursor.insert(killed)
        recordYank(start, killed.length)
        return { type: 'cursor', cursor: next }
    }
    case 'deleteBackward':
      return { type: 'cursor', cursor: cursor.backspace() }
    case 'deleteForward':
      return { type: 'cursor', cursor: cursor.del() }
    case 'deleteWordForward':
      return { type: 'cursor', cursor: cursor.deleteWordAfter() }
    case 'historyUp':
      if (options?.multiline && cursor.measuredText.lineCount > 1) {
        const pos = cursor.getPosition()
        if (pos.line === 0) return { type: 'action', action: 'historyUp' }
        return { type: 'cursor', cursor: cursor.up() }
      }
      return { type: 'action', action: 'historyUp' }
    case 'historyDown':
      if (options?.multiline && cursor.measuredText.lineCount > 1) {
        const pos = cursor.getPosition()
        if (pos.line >= cursor.measuredText.lineCount - 1) return { type: 'action', action: 'historyDown' }
        return { type: 'cursor', cursor: cursor.down() }
      }
      return { type: 'action', action: 'historyDown' }
    case 'insertNewline':
      if (options?.multiline) return { type: 'cursor', cursor: cursor.insert('\n') }
      return { type: 'action', action: 'submit' }
    case 'submit':
      return { type: 'action', action: 'submit' }
  }

  if (key.raw && !key.ctrl && !key.meta) {
    return { type: 'cursor', cursor: cursor.insert(key.raw) }
  }

  return { type: 'cursor', cursor }
}

export function useTextInput(props: UseTextInputProps): BaseInputState {
  const cursor = Cursor.fromText(props.value, props.columns, props.cursorOffset)

  return {
    onKeyEvent: (key: KeyEvent) => {
      const result = processTextInputKey(cursor, key, { multiline: props.multiline, keybindings: props.keybindings })

      if (result.type === 'action') {
        if (result.action === 'submit') props.onSubmit?.(props.value)
        if (result.action === 'historyUp') props.onHistoryUp?.()
        if (result.action === 'historyDown') props.onHistoryDown?.()
        return
      }

      if (result.cursor.text !== props.value) {
        props.onChange(result.cursor.text)
      }
      if (result.cursor.offset !== props.cursorOffset || result.cursor.text !== props.value) {
        props.onChangeCursorOffset(result.cursor.offset)
      }
    },
    renderedValue: props.value,
    offset: props.cursorOffset,
    cursorLine: 0,
    cursorColumn: cursor.offset,
  }
}
