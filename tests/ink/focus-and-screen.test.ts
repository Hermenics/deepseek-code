import { describe, expect, it } from 'bun:test'
import { appendChildNode, createNode, removeChildNode } from '../../src/ink/dom.js'
import { FocusManager } from '../../src/ink/focus.js'
import {
  CellWidth,
  CharPool,
  cellAt,
  charInCellAt,
  createScreen,
  HyperlinkPool,
  setCellAt,
  StylePool,
} from '../../src/ink/screen.js'

describe('Ink focus contract', () => {
  it('cycles tabbable nodes and restores focus after removal', () => {
    const root = createNode('ink-root')
    const first = createNode('ink-box')
    const second = createNode('ink-box')
    first.attributes.tabIndex = 0
    second.attributes.tabIndex = 0
    appendChildNode(root, first)
    appendChildNode(root, second)

    const events: string[] = []
    const focus = new FocusManager((_target, event) => {
      events.push(event.type)
      return true
    })

    focus.focusNext(root)
    focus.focusNext(root)
    expect(focus.activeElement).toBe(second)

    removeChildNode(root, second)
    focus.handleNodeRemoved(second, root)

    expect(focus.activeElement).toBe(first)
    expect(events).toEqual(['focus', 'blur', 'focus', 'blur', 'focus'])
  })
})

describe('Ink Unicode screen contract', () => {
  it('keeps a wide grapheme and its spacer aligned', () => {
    const styles = new StylePool()
    const screen = createScreen(4, 1, styles, new CharPool(), new HyperlinkPool())

    setCellAt(screen, 0, 0, {
      char: '漢', styleId: styles.none, width: CellWidth.Wide, hyperlink: undefined,
    })

    expect(charInCellAt(screen, 0, 0)).toBe('漢')
    expect(cellAt(screen, 0, 0)?.width).toBe(CellWidth.Wide)
    expect(cellAt(screen, 1, 0)).toMatchObject({ char: '', width: CellWidth.SpacerTail })
  })
})
