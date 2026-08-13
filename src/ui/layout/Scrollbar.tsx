import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import Text from '../../ink/components/Text.js'
import { NoSelect } from '../../ink/components/NoSelect.js'
import type { DOMElement } from '../../ink/dom.js'
import type { ScrollBoxHandle } from '../../ink/components/ScrollBox.js'

const TRACK = '│'
const FULL = '█'
const UPPER_HALF = '▀'
const LOWER_HALF = '▄'

const TRACK_COLOR = '#3a3a3a'
const THUMB_COLOR = '#888888'

export interface ThumbGeometry {
  /** Thumb start, in half-line units from the top of the track. */
  startSub: number
  /** Thumb length, in half-line units. */
  sizeSub: number
}

/**
 * Thumb geometry in half-line units — two sub-rows per terminal cell, so the
 * bar can move in half-character steps instead of jumping a whole line at a
 * time. Returns null when the content fits and there is nothing to indicate.
 */
export function computeThumb(
  scrollTop: number,
  scrollHeight: number,
  viewportHeight: number,
): ThumbGeometry | null {
  if (viewportHeight <= 0 || scrollHeight <= viewportHeight) return null

  const totalSub = viewportHeight * 2
  const sizeSub = Math.max(
    1,
    Math.min(totalSub, Math.round((totalSub * viewportHeight) / scrollHeight)),
  )
  const maxScroll = scrollHeight - viewportHeight
  const clamped = Math.max(0, Math.min(scrollTop, maxScroll))
  const startSub =
    maxScroll === 0 ? 0 : Math.round(((totalSub - sizeSub) * clamped) / maxScroll)

  return { startSub, sizeSub }
}

/**
 * Render one track cell: each cell covers two half-line slots, so a thumb edge
 * landing mid-cell draws as a half block instead of rounding away.
 */
export function thumbCell(row: number, thumb: ThumbGeometry): string {
  const end = thumb.startSub + thumb.sizeSub
  const top = row * 2 >= thumb.startSub && row * 2 < end
  const bottom = row * 2 + 1 >= thumb.startSub && row * 2 + 1 < end
  if (top && bottom) return FULL
  if (top) return UPPER_HALF
  if (bottom) return LOWER_HALF
  return TRACK
}

interface Geometry {
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}

/**
 * Read the box's current scroll geometry, working around two staleness traps:
 *
 * - `getScrollHeight()` is a cache written on a throttle, so it still holds the
 *   pre-growth height right after content grew. `getFreshScrollHeight()` asks
 *   Yoga directly.
 * - `stickyScroll` re-pins the offset during Ink's render, which runs after
 *   layout effects — so `getScrollTop()` reports the pre-growth offset. When
 *   the box is pinned we already know where it will land: the bottom.
 */
function readGeometry(box: ScrollBoxHandle): Geometry {
  const viewportHeight = box.getViewportHeight()
  const scrollHeight = box.getFreshScrollHeight()
  const maxScroll = Math.max(0, scrollHeight - viewportHeight)
  const scrollTop = box.isSticky() ? maxScroll : box.getScrollTop()
  return { scrollTop, scrollHeight, viewportHeight }
}

/**
 * A one-column scrollbar for a {@link ScrollBox}, drawn only while there is
 * something to scroll. Reads geometry from the box's imperative handle at
 * render time — Yoga has already laid out by then, so the values match the
 * frame being painted.
 */
export function Scrollbar({
  target,
}: {
  target: RefObject<ScrollBoxHandle | null>
  /**
   * Any value that changes when the transcript's content changes. The bar reads
   * its geometry from the ScrollBox's DOM node, which the Ink renderer mutates
   * outside React — so React (and the React Compiler, which memoizes on the
   * stable `target` ref alone) has no way to know a redraw is due. Passing a
   * changing revision is what tells it. Not read inside the component.
   */
  revision?: unknown
}): React.ReactNode {
  const [, redraw] = useState(0)
  const painted = useRef('')

  // Manual scrolling mutates scrollTop on the DOM node without going through
  // React, so subscribe to redraw the thumb. Growth-driven (sticky) scrolling
  // does not notify — but it only happens when App state changed, which
  // re-renders us anyway.
  useEffect(() => {
    return target.current?.subscribe(() => redraw(n => n + 1))
  }, [target])

  // React renders before Ink lays out, so during render the box still reports
  // the PREVIOUS frame's geometry — the bar would always trail one frame behind
  // the content. Ink writes the new numbers during its commit, which lands
  // before layout effects run, so by here they are current: compare them
  // against what we actually drew and redraw when they disagree. Self-limiting
  // — once the drawn geometry matches, this stops scheduling renders.
  useLayoutEffect(() => {
    const box = target.current
    if (!box) return
    const { scrollTop, scrollHeight, viewportHeight } = readGeometry(box)
    const geometry = `${scrollTop}:${scrollHeight}:${viewportHeight}`
    if (geometry === painted.current) return
    painted.current = geometry
    redraw(n => n + 1)
  })

  const box = target.current
  // Same reader as the layout effect's comparison, so what we draw and what we
  // check for staleness can never disagree.
  const geometry = box ? readGeometry(box) : null
  const thumb = geometry
    ? computeThumb(geometry.scrollTop, geometry.scrollHeight, geometry.viewportHeight)
    : null

  // Claim pointer drags over the bar. Fires on press and on every motion
  // until release, so press-to-jump and grab-and-drag are the same code path:
  // the row under the pointer becomes the scroll position, thumb centred
  // there. Rows arrive in absolute screen coordinates and are deliberately
  // unclamped by the caller, so dragging past either end pins to that end.
  const attach = useCallback(
    (element: DOMElement | null) => {
      if (!element) return
      element.onPointerDrag = (_col, row) => {
        const current = target.current
        if (!current) return
        const { scrollHeight, viewportHeight } = readGeometry(current)
        if (viewportHeight <= 0 || scrollHeight <= viewportHeight) return
        const localRow = row - current.getViewportTop()
        const fraction = (localRow + 0.5) / viewportHeight
        const centred = fraction * scrollHeight - viewportHeight / 2
        const maxScroll = scrollHeight - viewportHeight
        current.scrollTo(Math.max(0, Math.min(maxScroll, Math.round(centred))))
        redraw(n => n + 1)
      }
    },
    [target],
  )

  // NoSelect: without it a click-drag across the transcript swallows the bar
  // into the selection — the thumb highlights and its glyphs land in the copied
  // text. NoSelect keeps the gutter visually untouched and out of the clipboard.
  //
  // The column is reserved whether or not a thumb is drawn. Showing and hiding
  // it would change the transcript's width, which re-wraps the text, which
  // changes the content height — which can flip the "does it overflow" answer
  // and oscillate forever. A stable gutter is the same reason CSS grew
  // `scrollbar-gutter: stable`.
  return (
    <NoSelect ref={attach} flexDirection="column" width={1} flexShrink={0}>
      {thumb &&
        Array.from({ length: geometry!.viewportHeight }, (_, row) => {
          const cell = thumbCell(row, thumb)
          return (
            <Text key={row} color={cell === TRACK ? TRACK_COLOR : THUMB_COLOR}>
              {cell}
            </Text>
          )
        })}
    </NoSelect>
  )
}

export default Scrollbar
