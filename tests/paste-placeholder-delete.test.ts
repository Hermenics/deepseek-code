import { describe, it, expect } from 'bun:test'
import { Cursor, placeholderSpanAt } from '../src/ui/input/cursor/Cursor.js'

const COLS = 80
const at = (text: string, offset: number) => Cursor.fromText(text, COLS, offset)

describe('placeholderSpanAt', () => {
  it('finds the placeholder a backspace would cut into', () => {
    expect(placeholderSpanAt('hi [Text #1]', 12, 'before')).toEqual({ start: 3, end: 12 })
  })

  it('finds the placeholder a delete would cut into', () => {
    expect(placeholderSpanAt('hi [Text #1]', 3, 'after')).toEqual({ start: 3, end: 12 })
  })

  it('ignores a cursor sitting outside the placeholder', () => {
    expect(placeholderSpanAt('hi [Text #1]', 3, 'before')).toBeNull()
    expect(placeholderSpanAt('hi [Text #1]', 12, 'after')).toBeNull()
  })

  it('picks the placeholder the cursor is actually in', () => {
    const text = '[Text #1] and [Text #2]'
    expect(placeholderSpanAt(text, 23, 'before')).toEqual({ start: 14, end: 23 })
  })

  it('returns null for text with no placeholders', () => {
    expect(placeholderSpanAt('just words', 5, 'before')).toBeNull()
  })
})

describe('Cursor backspace over a paste placeholder', () => {
  it('removes the whole placeholder from its end', () => {
    const next = at('hi [Text #1]', 12).backspace()
    expect(next.text).toBe('hi ')
    expect(next.offset).toBe(3)
  })

  it('removes the whole placeholder from the middle', () => {
    const next = at('hi [Text #1] bye', 7).backspace()
    expect(next.text).toBe('hi  bye')
  })

  it('removes only the placeholder the cursor is in', () => {
    const next = at('[Text #1] and [Text #2]', 23).backspace()
    expect(next.text).toBe('[Text #1] and ')
  })

  it('still deletes one character in ordinary text', () => {
    const next = at('hello', 5).backspace()
    expect(next.text).toBe('hell')
  })

  it('does not touch a placeholder the cursor only sits before', () => {
    const next = at('ab[Text #1]', 2).backspace()
    expect(next.text).toBe('a[Text #1]')
  })
})

describe('Cursor delete over a paste placeholder', () => {
  it('removes the whole placeholder from its first character', () => {
    const next = at('hi [Text #1]', 3).del()
    expect(next.text).toBe('hi ')
    expect(next.offset).toBe(3)
  })

  it('removes the whole placeholder from the middle', () => {
    const next = at('[Text #1] tail', 4).del()
    expect(next.text).toBe(' tail')
  })

  it('still deletes one character in ordinary text', () => {
    const next = at('hello', 0).del()
    expect(next.text).toBe('ello')
  })

  it('does not touch a placeholder the cursor only sits after', () => {
    const next = at('[Text #1]xy', 9).del()
    expect(next.text).toBe('[Text #1]y')
  })
})
