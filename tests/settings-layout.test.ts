/**
 * The wide settings layout used to pin its two columns at fixed widths, so
 * a terminal with room to spare still clipped labels and descriptions while
 * a third of the screen stayed empty.
 */
import { describe, expect, it } from 'bun:test'
import { getSettingsLayout, itemsColumnWidth } from '../src/ui/setup/ConfigMenu.js'

/** Padding inside the column; what is left is what text can occupy. */
const usable = (width: number) => itemsColumnWidth(width) - 2

/** The two strings the report was about, as they are painted. */
const LONGEST_ROW = '  Legacy default model'.length + '  deepseek-flash'.length
const CATEGORY_DESCRIPTION = 'Named provider connections and model defaults.'.length

describe('settings items column', () => {
  it('fits the row that used to be clipped, at the width that clipped it', () => {
    // The reported terminal was around 115 columns and still showed
    // "Legacy default mod" next to a cut-off description.
    expect(usable(115)).toBeGreaterThanOrEqual(LONGEST_ROW)
    expect(usable(115)).toBeGreaterThanOrEqual(CATEGORY_DESCRIPTION)
  })

  it('fits them at the narrowest terminal the wide layout accepts', () => {
    const narrowestWide = 110
    expect(getSettingsLayout(narrowestWide)).toBe('wide')
    expect(usable(narrowestWide)).toBeGreaterThanOrEqual(LONGEST_ROW)
    expect(usable(narrowestWide)).toBeGreaterThanOrEqual(CATEGORY_DESCRIPTION)
  })

  it('stops growing, so a label and its value stay on speaking terms', () => {
    // space-between spends every extra column on the gap between the two.
    expect(itemsColumnWidth(200)).toBe(itemsColumnWidth(140))
    expect(itemsColumnWidth(2000)).toBeLessThanOrEqual(60)
  })

  it('never returns less than the width it replaced', () => {
    for (const width of [110, 111, 120, 160]) {
      expect(itemsColumnWidth(width)).toBeGreaterThanOrEqual(38)
    }
  })

  it('keeps the layout thresholds it always had', () => {
    expect(getSettingsLayout(109)).toBe('medium')
    expect(getSettingsLayout(110)).toBe('wide')
    expect(getSettingsLayout(71)).toBe('narrow')
    expect(getSettingsLayout(72)).toBe('medium')
  })
})
