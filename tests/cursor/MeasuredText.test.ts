import { describe, it, expect } from 'bun:test'
import { MeasuredText } from '../../src/ui/input/cursor/MeasuredText.js'

describe('MeasuredText', () => {
  describe('constructor / normalization', () => {
    it('should normalize NFD text to NFC on construction', () => {
      // 'é' in NFD is 2 code units (e + combining accent), in NFC is 1
      const nfd = 'é' // NFD form of é
      const mt = new MeasuredText(nfd, 80)
      expect(mt.text).toBe('é') // NFC form
    })

    it('should keep already-NFC text unchanged', () => {
      const mt = new MeasuredText('hello', 80)
      expect(mt.text).toBe('hello')
    })
  })

  describe('nextOffset', () => {
    it('should advance by one ASCII character', () => {
      const mt = new MeasuredText('abc', 80)
      expect(mt.nextOffset(0)).toBe(1)
      expect(mt.nextOffset(1)).toBe(2)
    })

    it('should advance past a multi-byte emoji as a single grapheme', () => {
      // 👍 is U+1F44D — 2 UTF-16 code units in JS strings
      const mt = new MeasuredText('👍x', 80)
      expect(mt.nextOffset(0)).toBe(2) // skip both surrogate code units
    })

    it('should advance past a ZWJ family emoji sequence as a single grapheme', () => {
      // 👨‍👩‍👧‍👦 is a ZWJ sequence — many code units but 1 grapheme
      const family = '👨‍👩‍👧‍👦'
      const mt = new MeasuredText(family + 'x', 80)
      expect(mt.nextOffset(0)).toBe(family.length)
    })

    it('should return text.length when already at the end', () => {
      const mt = new MeasuredText('hi', 80)
      expect(mt.nextOffset(2)).toBe(2)
    })
  })

  describe('prevOffset', () => {
    it('should retreat by one ASCII character', () => {
      const mt = new MeasuredText('abc', 80)
      expect(mt.prevOffset(3)).toBe(2)
      expect(mt.prevOffset(1)).toBe(0)
    })

    it('should retreat past a multi-byte emoji as a single grapheme', () => {
      const mt = new MeasuredText('x👍', 80)
      // offset 3 is after 👍 (1 ASCII + 2 surrogate units)
      expect(mt.prevOffset(3)).toBe(1)
    })

    it('should return 0 when already at the start', () => {
      const mt = new MeasuredText('hi', 80)
      expect(mt.prevOffset(0)).toBe(0)
    })
  })

  describe('getWordBoundaries', () => {
    it('should return word-like segments for simple ASCII words', () => {
      const mt = new MeasuredText('hello world', 80)
      const boundaries = mt.getWordBoundaries()
      const words = boundaries.filter(b => b.isWordLike).map(b => b.start)
      expect(words).toContain(0)  // 'hello' starts at 0
      expect(words).toContain(6)  // 'world' starts at 6
    })

    it('should mark spaces as non-word-like', () => {
      const mt = new MeasuredText('a b', 80)
      const boundaries = mt.getWordBoundaries()
      const space = boundaries.find(b => !b.isWordLike && b.start === 1)
      expect(space).toBeDefined()
    })

    it('should treat punctuation as non-word-like between words', () => {
      const mt = new MeasuredText('hello, world', 80)
      const boundaries = mt.getWordBoundaries()
      const wordLike = boundaries.filter(b => b.isWordLike).map(b =>
        mt.text.slice(b.start, b.end),
      )
      expect(wordLike).toContain('hello')
      expect(wordLike).toContain('world')
    })

    it('should return correct start/end offsets for each segment', () => {
      const mt = new MeasuredText('ab cd', 80)
      const boundaries = mt.getWordBoundaries()
      for (const b of boundaries) {
        expect(b.end).toBeGreaterThan(b.start)
        expect(b.start).toBeGreaterThanOrEqual(0)
        expect(b.end).toBeLessThanOrEqual(mt.text.length)
      }
    })
  })

  describe('getPositionFromOffset', () => {
    it('should return line 0 column 0 for offset 0', () => {
      const mt = new MeasuredText('hello', 80)
      expect(mt.getPositionFromOffset(0)).toEqual({ line: 0, column: 0 })
    })

    it('should return correct column for ASCII text on a single line', () => {
      const mt = new MeasuredText('hello', 80)
      expect(mt.getPositionFromOffset(3)).toEqual({ line: 0, column: 3 })
    })

    it('should return line 1 for offset past a newline', () => {
      const mt = new MeasuredText('hello\nworld', 80)
      // 'world' starts at offset 6
      const pos = mt.getPositionFromOffset(6)
      expect(pos.line).toBe(1)
      expect(pos.column).toBe(0)
    })

    it('should account for CJK double-width characters in column calculation', () => {
      // '中' is a CJK character with display width 2
      const mt = new MeasuredText('中x', 80)
      // offset 1 is after '中' (1 code unit), but display column should be 2
      const pos = mt.getPositionFromOffset(1)
      expect(pos.column).toBe(2)
    })
  })

  describe('lineCount', () => {
    it('should return 1 for single-line text', () => {
      const mt = new MeasuredText('hello', 80)
      expect(mt.lineCount).toBe(1)
    })

    it('should return 2 for text with one newline', () => {
      const mt = new MeasuredText('hello\nworld', 80)
      expect(mt.lineCount).toBe(2)
    })

    it('should wrap long lines and increase lineCount', () => {
      // 20 chars wide terminal, text is 40 chars — should wrap to at least 2 lines
      const longText = 'a'.repeat(40)
      const mt = new MeasuredText(longText, 20)
      expect(mt.lineCount).toBeGreaterThanOrEqual(2)
    })
  })

  describe('display width (stringIndexToDisplayWidth)', () => {
    it('should return correct width for ASCII text', () => {
      const mt = new MeasuredText('hello', 80)
      expect(mt.stringIndexToDisplayWidth('hello', 5)).toBe(5)
    })

    it('should return double width for CJK characters', () => {
      const mt = new MeasuredText('中文', 80)
      // '中文' has 2 CJK chars, each width 2 → total 4
      expect(mt.stringIndexToDisplayWidth('中文', 2)).toBe(4)
    })

    it('should return 0 for index 0', () => {
      const mt = new MeasuredText('hello', 80)
      expect(mt.stringIndexToDisplayWidth('hello', 0)).toBe(0)
    })
  })
})
