import { describe, expect, it } from 'bun:test'
import { filterFeatureFlags } from '../src/features.js'

describe('filterFeatureFlags', () => {
  it('keeps only known boolean feature overrides', () => {
    expect(filterFeatureFlags({
      wordDiff: false,
      microCompact: 'false',
      fuzzyFileSearch: 1,
      futureFeature: true,
    })).toEqual({ wordDiff: false })
  })
})
