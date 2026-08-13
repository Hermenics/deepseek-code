import { describe, expect, it } from 'bun:test'
import { computeThumb, thumbCell } from '../src/ui/layout/Scrollbar.js'

/** Render the whole track as a string, the way the component paints it. */
function track(scrollTop: number, scrollHeight: number, viewportHeight: number): string | null {
  const thumb = computeThumb(scrollTop, scrollHeight, viewportHeight)
  if (!thumb) return null
  return Array.from({ length: viewportHeight }, (_, row) => thumbCell(row, thumb)).join('')
}

describe('computeThumb', () => {
  it('draws nothing when the content fits', () => {
    expect(computeThumb(0, 10, 20)).toBeNull()
    expect(computeThumb(0, 20, 20)).toBeNull()
  })

  it('draws nothing before the box has been laid out', () => {
    expect(computeThumb(0, 0, 0)).toBeNull()
  })

  it('sizes the thumb proportionally to the visible fraction', () => {
    // Half the content visible → thumb covers half the track.
    const half = computeThumb(0, 40, 20)!
    expect(half.sizeSub).toBe(20) // of 40 half-line slots
    // A tenth visible → a tenth of the track.
    const tenth = computeThumb(0, 200, 20)!
    expect(tenth.sizeSub).toBe(4)
  })

  it('keeps the thumb visible even with enormous content', () => {
    const huge = computeThumb(0, 1_000_000, 20)!
    expect(huge.sizeSub).toBe(1)
  })

  it('pins the thumb to the top at scrollTop 0 and to the bottom at max', () => {
    const top = computeThumb(0, 40, 20)!
    expect(top.startSub).toBe(0)

    const bottom = computeThumb(20, 40, 20)!
    expect(bottom.startSub + bottom.sizeSub).toBe(40) // flush with the track end
  })

  it('clamps out-of-range scroll positions instead of overflowing the track', () => {
    const past = computeThumb(9999, 40, 20)!
    expect(past.startSub + past.sizeSub).toBe(40)
    const negative = computeThumb(-50, 40, 20)!
    expect(negative.startSub).toBe(0)
  })

  it('moves in half-line steps, not whole lines', () => {
    // 10 rows, content twice the viewport: 10 scroll units across 10 half-slots
    // of travel, so consecutive positions must differ by a half line.
    const positions = [0, 1, 2].map(top => computeThumb(top, 20, 10)!.startSub)
    expect(positions).toEqual([0, 1, 2])
  })
})

describe('thumbCell', () => {
  it('uses half blocks for thumb edges landing mid-cell', () => {
    // Thumb from half-slot 1 to 3 → row 0 lower half, row 1 upper half.
    expect(thumbCell(0, { startSub: 1, sizeSub: 2 })).toBe('▄')
    expect(thumbCell(1, { startSub: 1, sizeSub: 2 })).toBe('▀')
  })

  it('uses a full block when a cell is entirely covered', () => {
    expect(thumbCell(0, { startSub: 0, sizeSub: 2 })).toBe('█')
  })

  it('draws track outside the thumb', () => {
    expect(thumbCell(5, { startSub: 0, sizeSub: 2 })).toBe('│')
  })

  it('paints a contiguous thumb over the whole track', () => {
    const bar = track(0, 40, 10)!
    expect(bar).toHaveLength(10)
    // A quarter of the content is visible, so the thumb is 2.5 rows tall —
    // the half block is what makes that representable at all.
    expect(bar).toBe('██▀│││││││')
    // No gaps: every thumb glyph is in one run.
    expect(/^[█▀▄]+│*$/.test(bar)).toBe(true)
  })

  it('walks the thumb down the track as scrollTop grows', () => {
    const top = track(0, 40, 10)!
    const middle = track(10, 40, 10)!
    const bottom = track(30, 40, 10)!
    expect(top.indexOf('█')).toBeLessThan(middle.indexOf('█'))
    expect(middle.indexOf('█')).toBeLessThan(bottom.indexOf('█'))
    expect(bottom.endsWith('█')).toBe(true)
  })
})
