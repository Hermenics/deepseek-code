import { describe, it, expect, beforeEach, mock } from 'bun:test'

// Este import vai falhar (RED) porque useTextInput como hook React
// com a assinatura UseTextInputProps ainda não existe.
// A implementação atual exporta processTextInputKey (função pura),
// não um hook com controlled state (value/onChange/cursorOffset/onChangeCursorOffset).
import { useTextInput } from '../../../src/ui/input/hooks/useTextInput.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<Parameters<typeof useTextInput>[0]> = {}) {
  const onChange = mock(() => {})
  const onChangeCursorOffset = mock(() => {})
  return {
    value: '',
    onChange,
    cursorOffset: 0,
    onChangeCursorOffset,
    columns: 80,
    ...overrides,
  }
}

function fireKey(
  state: ReturnType<typeof useTextInput>,
  key: {
    name?: string
    ctrl?: boolean
    meta?: boolean
    shift?: boolean
    option?: boolean
    raw?: string
    sequence?: string
  },
) {
  state.onKeyEvent(key)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useTextInput', () => {
  describe('character insertion', () => {
    it('should call onChange with inserted character when key "a" is pressed', () => {
      const props = makeProps({ value: '', cursorOffset: 0 })
      const state = useTextInput(props)

      fireKey(state, { name: 'a', raw: 'a' })

      expect(props.onChange).toHaveBeenCalledWith('a')
    })

    it('should call onChangeCursorOffset with 1 after inserting one character', () => {
      const props = makeProps({ value: '', cursorOffset: 0 })
      const state = useTextInput(props)

      fireKey(state, { name: 'a', raw: 'a' })

      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(1)
    })

    it('should append character at cursor position when value is non-empty', () => {
      const props = makeProps({ value: 'hi', cursorOffset: 2 })
      const state = useTextInput(props)

      fireKey(state, { name: 'z', raw: 'z' })

      expect(props.onChange).toHaveBeenCalledWith('hiz')
      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(3)
    })
  })

  describe('backspace', () => {
    it('should call onChange with last char removed when backspace is pressed at end', () => {
      const props = makeProps({ value: 'hello', cursorOffset: 5 })
      const state = useTextInput(props)

      fireKey(state, { name: 'backspace', raw: '\x7f' })

      expect(props.onChange).toHaveBeenCalledWith('hell')
      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(4)
    })

    it('should not call onChange when backspace is pressed at offset 0', () => {
      const props = makeProps({ value: 'hello', cursorOffset: 0 })
      const state = useTextInput(props)

      fireKey(state, { name: 'backspace', raw: '\x7f' })

      expect(props.onChange).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl+A — start of line', () => {
    it('should call onChangeCursorOffset(0) when Ctrl+A is pressed', () => {
      const props = makeProps({ value: 'hello', cursorOffset: 3 })
      const state = useTextInput(props)

      fireKey(state, { name: 'a', ctrl: true })

      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(0)
      expect(props.onChange).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl+E — end of line', () => {
    it('should call onChangeCursorOffset(5) when Ctrl+E is pressed on "hello"', () => {
      const props = makeProps({ value: 'hello', cursorOffset: 0 })
      const state = useTextInput(props)

      fireKey(state, { name: 'e', ctrl: true })

      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(5)
      expect(props.onChange).not.toHaveBeenCalled()
    })
  })

  describe('Ctrl+K — kill to end of line', () => {
    it('should call onChange with text before cursor when Ctrl+K is pressed', () => {
      const props = makeProps({ value: 'hello', cursorOffset: 2 })
      const state = useTextInput(props)

      fireKey(state, { name: 'k', ctrl: true })

      expect(props.onChange).toHaveBeenCalledWith('he')
      // cursor stays at offset 2
      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(2)
    })
  })

  describe('Enter — submit', () => {
    it('should call onSubmit with current value when Enter is pressed', () => {
      const onSubmit = mock(() => {})
      const props = makeProps({ value: 'hello', cursorOffset: 5, onSubmit })
      const state = useTextInput(props)

      fireKey(state, { name: 'return', raw: '\r' })

      expect(onSubmit).toHaveBeenCalledWith('hello')
    })

    it('should call onSubmit when key name is "enter"', () => {
      const onSubmit = mock(() => {})
      const props = makeProps({ value: 'world', cursorOffset: 5, onSubmit })
      const state = useTextInput(props)

      fireKey(state, { name: 'enter', raw: '\n' })

      expect(onSubmit).toHaveBeenCalledWith('world')
    })
  })

  describe('Arrow Up — history', () => {
    it('should call onHistoryUp when arrow up is pressed', () => {
      const onHistoryUp = mock(() => {})
      const props = makeProps({ value: '', cursorOffset: 0, onHistoryUp })
      const state = useTextInput(props)

      fireKey(state, { name: 'up', raw: '\x1b[A' })

      expect(onHistoryUp).toHaveBeenCalled()
    })
  })

  describe('Arrow Down — history', () => {
    it('should call onHistoryDown when arrow down is pressed', () => {
      const onHistoryDown = mock(() => {})
      const props = makeProps({ value: '', cursorOffset: 0, onHistoryDown })
      const state = useTextInput(props)

      fireKey(state, { name: 'down', raw: '\x1b[B' })

      expect(onHistoryDown).toHaveBeenCalled()
    })
  })

  describe('Ctrl+W — delete word before cursor', () => {
    it('should delete last word and update offset when Ctrl+W is pressed', () => {
      const props = makeProps({ value: 'hello world', cursorOffset: 11 })
      const state = useTextInput(props)

      fireKey(state, { name: 'w', ctrl: true })

      // "world" (5 chars + space = 6) removed → "hello " remains, offset = 6
      expect(props.onChange).toHaveBeenCalledWith('hello ')
      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(6)
    })
  })

  describe('Shift+Enter — multiline newline', () => {
    it('should insert newline when Shift+Enter is pressed and multiline=true', () => {
      const props = makeProps({ value: 'hello', cursorOffset: 5, multiline: true })
      const state = useTextInput(props)

      fireKey(state, { name: 'return', shift: true, raw: '\r' })

      expect(props.onChange).toHaveBeenCalledWith('hello\n')
      expect(props.onChangeCursorOffset).toHaveBeenCalledWith(6)
    })

    it('should submit (not insert newline) when Shift+Enter is pressed and multiline=false', () => {
      const onSubmit = mock(() => {})
      const props = makeProps({ value: 'hello', cursorOffset: 5, multiline: false, onSubmit })
      const state = useTextInput(props)

      fireKey(state, { name: 'return', shift: true, raw: '\r' })

      expect(onSubmit).toHaveBeenCalledWith('hello')
      expect(props.onChange).not.toHaveBeenCalled()
    })
  })

  describe('renderedValue and offset', () => {
    it('should expose renderedValue equal to value prop', () => {
      const props = makeProps({ value: 'test', cursorOffset: 4 })
      const state = useTextInput(props)

      expect(state.renderedValue).toBe('test')
    })

    it('should expose offset equal to cursorOffset prop', () => {
      const props = makeProps({ value: 'test', cursorOffset: 2 })
      const state = useTextInput(props)

      expect(state.offset).toBe(2)
    })
  })
})
