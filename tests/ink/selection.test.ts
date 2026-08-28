import { describe, expect, it } from 'bun:test'
import {
  captureScrolledRows,
  createSelectionState,
  getSelectedText,
  shiftAnchor,
  shiftSelectionForFollow,
  startSelection,
  updateSelection,
} from '../../src/ink/selection.js'
import {
  CellWidth,
  CharPool,
  cellAtIndex,
  createScreen,
  HyperlinkPool,
  setCellAt,
  StylePool,
} from '../../src/ink/screen.js'
import { applySelectionOverlay } from '../../src/ink/selection.js'

function makeScreen(rows: string[]) {
  const styles = new StylePool()
  const screen = createScreen(5, rows.length, styles, new CharPool(), new HyperlinkPool())
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row]!.length; col++) {
      setCellAt(screen, col, row, {
        char: rows[row]![col]!,
        styleId: styles.none,
        width: CellWidth.Narrow,
        hyperlink: undefined,
      })
    }
  }
  return screen
}

describe('fullscreen text selection', () => {
  it('keeps rows that leave above the viewport in copy order', () => {
    const selection = createSelectionState()
    const screen = makeScreen(['zero0', 'one00', 'two00'])
    startSelection(selection, 1, 0)
    updateSelection(selection, 4, 2)

    captureScrolledRows(selection, screen, 0, 0, 'above')
    shiftAnchor(selection, -1, 0, 2)
    const nextScreen = makeScreen(['one00', 'two00', 'three'])

    expect(getSelectedText(selection, nextScreen)).toBe('ero0\none00\ntwo00\nthree')
  })

  it('keeps rows that leave below the viewport in copy order', () => {
    const selection = createSelectionState()
    const screen = makeScreen(['zero0', 'one00', 'two00'])
    startSelection(selection, 4, 2)
    updateSelection(selection, 0, 0)

    captureScrolledRows(selection, screen, 2, 2, 'below')
    shiftAnchor(selection, 1, 0, 2)
    const nextScreen = makeScreen(['minus', 'zero0', 'one00'])

    expect(getSelectedText(selection, nextScreen)).toBe('minus\nzero0\none00\ntwo00')
  })

  it('keeps the written end of a partial wrapped row after it leaves', () => {
    const selection = createSelectionState()
    const screen = makeScreen(['zero ', 'next'])
    // The continuation row is outside the visible region in the real case,
    // so softWrap[0 + 1] is unavailable. softWrapEnd is the durable fallback.
    screen.softWrapEnd[0] = 5
    startSelection(selection, 1, 0)
    updateSelection(selection, 4, 0)

    captureScrolledRows(selection, screen, 0, 0, 'below')

    expect(selection.scrolledOffBelow).toEqual(['ero '])
  })

  it('clears a selection when both endpoints leave either viewport edge', () => {
    const selection = createSelectionState()
    startSelection(selection, 0, 0)
    updateSelection(selection, 4, 2)

    expect(shiftSelectionForFollow(selection, 3, 0, 2)).toBe(true)
    expect(selection.anchor).toBeNull()
    expect(selection.focus).toBeNull()
  })

  it('changes only the background of selected cells', () => {
    const styles = new StylePool()
    const foreground = {
      type: 'ansi' as const,
      code: '\x1b[38;2;255;0;0m',
      endCode: '\x1b[39m',
    }
    const originalBackground = {
      type: 'ansi' as const,
      code: '\x1b[48;2;0;255;0m',
      endCode: '\x1b[49m',
    }
    styles.setSelectionBg({
      type: 'ansi',
      code: '\x1b[48;2;73;62;91m',
      endCode: '\x1b[49m',
    })
    const baseStyle = styles.intern([foreground, originalBackground])
    const screen = createScreen(2, 1, styles, new CharPool(), new HyperlinkPool())
    setCellAt(screen, 0, 0, {
      char: 'X',
      styleId: baseStyle,
      width: CellWidth.Narrow,
      hyperlink: undefined,
    })
    setCellAt(screen, 1, 0, {
      char: ' ',
      styleId: styles.none,
      width: CellWidth.Narrow,
      hyperlink: undefined,
    })
    const selection = createSelectionState()
    startSelection(selection, 0, 0)
    updateSelection(selection, 1, 0)

    applySelectionOverlay(screen, selection, styles)

    const selectedStyles = styles.get(cellAtIndex(screen, 0).styleId)
    expect(selectedStyles).toContainEqual(foreground)
    expect(selectedStyles).not.toContainEqual(originalBackground)
    expect(selectedStyles).toContainEqual({
      type: 'ansi',
      code: '\x1b[48;2;73;62;91m',
      endCode: '\x1b[49m',
    })
  })
})
