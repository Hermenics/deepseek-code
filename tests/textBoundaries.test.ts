import { describe, expect, it } from 'bun:test'
import { isGraphemeBoundary, safeGraphemeEnd, safeGraphemeStart } from '../src/utils/textBoundaries.js'

describe('grapheme-safe UTF-16 boundaries', () => {
  it('keeps combining marks with their base character', () => {
    const text = 'xe\u0301y'
    expect(safeGraphemeEnd(text, 2)).toBe(1)
    expect(safeGraphemeEnd(text, 3)).toBe(3)
    expect(safeGraphemeStart(text, 2)).toBe(3)
    expect(isGraphemeBoundary(text, 1)).toBe(true)
    expect(isGraphemeBoundary(text, 2)).toBe(false)
  })

  it('keeps emoji modifier, flag and ZWJ sequences intact', () => {
    for (const cluster of ['👩🏽', '🇺🇸', '👩‍💻']) {
      const text = `a${cluster}z`
      const cut = 1 + Math.floor(cluster.length / 2)
      expect(safeGraphemeEnd(text, cut)).toBe(1)
      expect(safeGraphemeStart(text, cut)).toBe(1 + cluster.length)
      expect(isGraphemeBoundary(text, 1 + cluster.length)).toBe(true)
    }
  })
})
