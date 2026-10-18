import { expect, it } from 'bun:test'
import { replaceObservedContract } from '../src/patch.js'

it('refuses the obsolete business premise but accepts the latest exact contract', () => {
  const current = '// reviewer: preserve this independent note\nif (balance < 1000) return true'
  expect(() => replaceObservedContract(current, 'if (balance < 5000)', 'if (balance < 2500)')).toThrow('stale')
  expect(replaceObservedContract(current, 'if (balance < 1000)', 'if (balance < 800)'))
    .toBe('// reviewer: preserve this independent note\nif (balance < 800) return true')
})

it('refuses an ambiguous observation rather than silently patching one occurrence', () => {
  const current = 'if (balance < 1000) return true\nif (balance < 1000) return false'
  expect(() => replaceObservedContract(current, 'if (balance < 1000)', 'if (balance < 800)')).toThrow(/ambiguous/i)
})
