import { describe, expect, it } from 'bun:test'
import cliBoxes from 'cli-boxes'
import { resolveBorderStyle } from '../src/ink/render-border.js'

describe('resolveBorderStyle', () => {
  it('supports the rounded style used by the UI', () => {
    expect(resolveBorderStyle('rounded')).toEqual(cliBoxes.round)
  })

  it('ignores invalid styles without crashing the renderer', () => {
    expect(resolveBorderStyle('missing' as never)).toBeUndefined()
    expect(resolveBorderStyle({ top: '─' } as never)).toBeUndefined()
  })
})
