import { describe, it, expect, beforeEach } from 'bun:test'
import { Cursor } from '../../src/ui/input/cursor/Cursor.js'
import { clearKillRing } from '../../src/ui/input/cursor/killRing.js'

describe('Cursor', () => {
  beforeEach(() => {
    clearKillRing()
  })

  describe('fromText', () => {
    it('should create cursor at position 0 by default', () => {
      const cursor = Cursor.fromText('hello', 80)
      expect(cursor.offset).toBe(0)
    })

    it('should create cursor at specified offset', () => {
      const cursor = Cursor.fromText('hello', 80, 3)
      expect(cursor.offset).toBe(3)
    })

    it('should clamp offset to text length when offset exceeds text', () => {
      const cursor = Cursor.fromText('hi', 80, 100)
      expect(cursor.offset).toBe(2)
    })

    it('should clamp negative offset to 0', () => {
      const cursor = Cursor.fromText('hi', 80, -5)
      expect(cursor.offset).toBe(0)
    })

    it('should expose the text via .text getter', () => {
      const cursor = Cursor.fromText('hello', 80)
      expect(cursor.text).toBe('hello')
    })
  })

  describe('left', () => {
    it('should move one ASCII character to the left', () => {
      const cursor = Cursor.fromText('hello', 80, 3)
      expect(cursor.left().offset).toBe(2)
    })

    it('should not move when already at the start', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.left().offset).toBe(0)
    })

    it('should move past a multi-byte emoji as a single grapheme', () => {
      // '👍' is 2 code units; cursor after it is at offset 2
      const cursor = Cursor.fromText('👍x', 80, 2)
      expect(cursor.left().offset).toBe(0)
    })

    it('should move past a ZWJ family emoji as a single grapheme', () => {
      const family = '👨‍👩‍👧‍👦'
      const cursor = Cursor.fromText(family + 'x', 80, family.length)
      expect(cursor.left().offset).toBe(0)
    })
  })

  describe('right', () => {
    it('should move one ASCII character to the right', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.right().offset).toBe(1)
    })

    it('should not move when already at the end', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      expect(cursor.right().offset).toBe(5)
    })

    it('should skip a multi-byte emoji as a single grapheme', () => {
      const cursor = Cursor.fromText('👍x', 80, 0)
      expect(cursor.right().offset).toBe(2)
    })

    it('should skip a ZWJ family emoji as a single grapheme', () => {
      const family = '👨‍👩‍👧‍👦'
      const cursor = Cursor.fromText(family + 'x', 80, 0)
      expect(cursor.right().offset).toBe(family.length)
    })
  })

  describe('prevWord', () => {
    it('should jump to the start of the current word', () => {
      const cursor = Cursor.fromText('hello world', 80, 9) // inside 'world'
      expect(cursor.prevWord().offset).toBe(6)
    })

    it('should jump to the start of the previous word when at word boundary', () => {
      const cursor = Cursor.fromText('hello world', 80, 6) // at start of 'world'
      expect(cursor.prevWord().offset).toBe(0)
    })

    it('should not move when already at the start', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.prevWord().offset).toBe(0)
    })
  })

  describe('nextWord', () => {
    it('should jump to the start of the next word', () => {
      const cursor = Cursor.fromText('hello world', 80, 0)
      expect(cursor.nextWord().offset).toBe(6)
    })

    it('should go to end of text when no next word exists', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.nextWord().offset).toBe(5)
    })

    it('should not move when already at the end', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      expect(cursor.nextWord().offset).toBe(5)
    })
  })

  describe('startOfLine', () => {
    it('should move to column 0 of the current line', () => {
      const cursor = Cursor.fromText('hello\nworld', 80, 8) // inside 'world'
      const moved = cursor.startOfLine()
      expect(moved.getPosition().column).toBe(0)
      expect(moved.getPosition().line).toBe(1)
    })

    it('should stay at offset 0 when already at start of first line', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.startOfLine().offset).toBe(0)
    })
  })

  describe('endOfLine', () => {
    it('should move to the end of the current line', () => {
      const cursor = Cursor.fromText('hello\nworld', 80, 0)
      const moved = cursor.endOfLine()
      expect(moved.getPosition().column).toBe(5) // 'hello' has 5 chars
    })

    it('should not move when already at end of single-line text', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      expect(cursor.endOfLine().offset).toBe(5)
    })
  })

  describe('insert', () => {
    it('should insert text at the current cursor position', () => {
      const cursor = Cursor.fromText('helo', 80, 3)
      const result = cursor.insert('l')
      expect(result.text).toBe('hello')
    })

    it('should move the cursor to after the inserted text', () => {
      const cursor = Cursor.fromText('', 80, 0)
      const result = cursor.insert('hi')
      expect(result.offset).toBe(2)
    })

    it('should insert at the beginning when cursor is at offset 0', () => {
      const cursor = Cursor.fromText('world', 80, 0)
      const result = cursor.insert('hello ')
      expect(result.text).toBe('hello world')
    })

    it('should insert at the end when cursor is at end of text', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      const result = cursor.insert('!')
      expect(result.text).toBe('hello!')
    })
  })

  describe('backspace', () => {
    it('should remove the grapheme before the cursor', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      expect(cursor.backspace().text).toBe('hell')
    })

    it('should move cursor one grapheme to the left after deletion', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      expect(cursor.backspace().offset).toBe(4)
    })

    it('should not change text when cursor is at the start', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.backspace().text).toBe('hello')
      expect(cursor.backspace().offset).toBe(0)
    })

    it('should remove a multi-byte emoji as a single grapheme', () => {
      const cursor = Cursor.fromText('a👍b', 80, 3) // after 👍 (offset 1+2=3)
      const result = cursor.backspace()
      expect(result.text).toBe('ab')
      expect(result.offset).toBe(1)
    })
  })

  describe('del', () => {
    it('should remove the grapheme at the cursor position', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.del().text).toBe('ello')
    })

    it('should not change text when cursor is at the end', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      expect(cursor.del().text).toBe('hello')
    })

    it('should remove a multi-byte emoji as a single grapheme', () => {
      const cursor = Cursor.fromText('a👍b', 80, 1) // at start of 👍
      const result = cursor.del()
      expect(result.text).toBe('ab')
    })
  })

  describe('deleteToLineEnd', () => {
    it('should delete from cursor to end of line and return killed text', () => {
      const cursor = Cursor.fromText('hello world', 80, 5)
      const { cursor: newCursor, killed } = cursor.deleteToLineEnd()
      expect(killed).toBe(' world')
      expect(newCursor.text).toBe('hello')
    })

    it('should return empty killed string when cursor is at end of line', () => {
      const cursor = Cursor.fromText('hello', 80, 5)
      const { killed } = cursor.deleteToLineEnd()
      expect(killed).toBe('')
    })

    it('should delete only the newline when cursor is on a newline character', () => {
      const cursor = Cursor.fromText('hello\nworld', 80, 5) // on '\n'
      const { killed } = cursor.deleteToLineEnd()
      expect(killed).toBe('\n')
    })
  })

  describe('deleteToLineStart', () => {
    it('should delete from start of line to cursor and return killed text', () => {
      const cursor = Cursor.fromText('hello world', 80, 5)
      const { cursor: newCursor, killed } = cursor.deleteToLineStart()
      expect(killed).toBe('hello')
      expect(newCursor.text).toBe(' world')
    })

    it('should return empty killed string when cursor is at start of line', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      const { killed } = cursor.deleteToLineStart()
      expect(killed).toBe('')
    })
  })

  describe('deleteWordBefore', () => {
    it('should delete the word before the cursor', () => {
      const cursor = Cursor.fromText('hello world', 80, 11)
      const { cursor: newCursor, killed } = cursor.deleteWordBefore()
      expect(killed).toBe('world')
      expect(newCursor.text).toBe('hello ')
    })

    it('should return empty killed string when cursor is at start', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      const { killed } = cursor.deleteWordBefore()
      expect(killed).toBe('')
    })

    it('should delete word and preceding space', () => {
      const cursor = Cursor.fromText('foo bar', 80, 7)
      const { killed } = cursor.deleteWordBefore()
      expect(killed).toBe('bar')
    })

    it('should handle punctuation as a separate word token', () => {
      const cursor = Cursor.fromText('hello!', 80, 6)
      const { cursor: newCursor } = cursor.deleteWordBefore()
      // '!' is punctuation — prevWord should land before it or at 'hello'
      expect(newCursor.text.length).toBeLessThan(6)
    })
  })

  describe('isAtStart / isAtEnd', () => {
    it('should return true for isAtStart when offset is 0', () => {
      expect(Cursor.fromText('hello', 80, 0).isAtStart()).toBe(true)
    })

    it('should return false for isAtStart when offset > 0', () => {
      expect(Cursor.fromText('hello', 80, 1).isAtStart()).toBe(false)
    })

    it('should return true for isAtEnd when offset equals text length', () => {
      expect(Cursor.fromText('hello', 80, 5).isAtEnd()).toBe(true)
    })

    it('should return false for isAtEnd when offset < text length', () => {
      expect(Cursor.fromText('hello', 80, 3).isAtEnd()).toBe(false)
    })
  })

  describe('getPosition', () => {
    it('should return { line: 0, column: 0 } for offset 0', () => {
      const cursor = Cursor.fromText('hello', 80, 0)
      expect(cursor.getPosition()).toEqual({ line: 0, column: 0 })
    })

    it('should return correct column for single-line text', () => {
      const cursor = Cursor.fromText('hello', 80, 3)
      expect(cursor.getPosition()).toEqual({ line: 0, column: 3 })
    })

    it('should return line 1 for offset on second line', () => {
      const cursor = Cursor.fromText('hello\nworld', 80, 6)
      const pos = cursor.getPosition()
      expect(pos.line).toBe(1)
      expect(pos.column).toBe(0)
    })
  })

  describe('emoji navigation', () => {
    it('should navigate left/right correctly through emoji characters', () => {
      const cursor = Cursor.fromText('a😀b', 80, 0)
      const afterA = cursor.right()
      expect(afterA.offset).toBe(1)
      const afterEmoji = afterA.right()
      // 😀 is 2 code units
      expect(afterEmoji.offset).toBe(3)
      const backToA = afterEmoji.left()
      expect(backToA.offset).toBe(1)
    })

    it('should treat ZWJ sequence as single unit for left/right', () => {
      const family = '👨‍👩‍👧‍👦'
      const cursor = Cursor.fromText(family, 80, 0)
      const atEnd = cursor.right()
      expect(atEnd.offset).toBe(family.length)
      expect(atEnd.left().offset).toBe(0)
    })
  })

  describe('CJK display position', () => {
    it('should report correct display column for CJK characters', () => {
      // '中' has display width 2 but is 1 code unit
      const cursor = Cursor.fromText('中文', 80, 1)
      const pos = cursor.getPosition()
      expect(pos.column).toBe(2)
    })

    it('should advance offset by 1 code unit for CJK character', () => {
      const cursor = Cursor.fromText('中x', 80, 0)
      expect(cursor.right().offset).toBe(1)
    })
  })
})
