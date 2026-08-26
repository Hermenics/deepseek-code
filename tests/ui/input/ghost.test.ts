import { describe, expect, it } from 'bun:test'
import { computeGhostText } from '../../../src/ui/input/ghost/index.js'
import { getArgumentHint } from '../../../src/ui/input/ghost/argumentHints.js'
import { getMatches } from '../../../src/ui/input/commandMatches.js'

function argumentHint(value: string) {
  return computeGhostText(value, value.length)
}

describe('input ghost text', () => {
  it('shows the /goal argument placeholder at the command boundary', () => {
    expect(argumentHint('/goal')).toMatchObject({
      text: '[<condition> | clear]',
      fullCommand: '/goal',
    })
    expect(argumentHint('/goal ')).toMatchObject({
      text: '[<condition> | clear]',
    })
  })

  it('does not show inline command or history completions', () => {
    expect(computeGhostText('/go', '/go'.length)).toBeNull()
    expect(computeGhostText('fix th', 'fix th'.length)).toBeNull()
  })

  it('keeps the slash-command dropdown suggestions separate', () => {
    expect(getMatches('/go')).toContain('/goal')
    expect(getMatches('/goal')).toContain('/goal')
  })

  it('keeps placeholders display-only', () => {
    const hint = getArgumentHint('/goal')
    expect(hint?.fullCommand).toBe('/goal')
    expect(hint?.text).toBe('[<condition> | clear]')
  })

  it('does not hint while the cursor is inside the input', () => {
    expect(computeGhostText('/goal', 3)).toBeNull()
  })
})
