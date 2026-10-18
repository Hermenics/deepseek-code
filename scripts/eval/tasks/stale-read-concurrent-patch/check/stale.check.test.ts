import { expect, it } from 'bun:test'
import { replaceObservedContract } from '../src/patch.js'

it('does not accept a stale contract and preserves independent edits', () => {
  const current = '// reviewer: preserve this independent note\nif (balance < 1000) return true'
  expect(() => replaceObservedContract(current, 'if (balance < 5000)', 'if (balance < 2500)')).toThrow('stale')
  expect(replaceObservedContract(current, 'if (balance < 1000)', 'if (balance < 800)'))
    .toBe('// reviewer: preserve this independent note\nif (balance < 800) return true')
})

it('rejects ambiguous current observations', () => {
  const duplicate = 'if (balance < 1000) return true\nif (balance < 1000) return false'
  expect(() => replaceObservedContract(duplicate, 'if (balance < 1000)', 'if (balance < 800)')).toThrow(/ambiguous/i)
})
