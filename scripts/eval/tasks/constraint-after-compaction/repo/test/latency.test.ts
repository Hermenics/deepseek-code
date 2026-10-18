import { expect, it } from 'bun:test'
import { summarizeLatency } from '../src/latency'

it('summarizes a single observation', () => {
  expect(summarizeLatency([17])).toEqual({ count: 1, p50: 17, p95: 17 })
})

it('returns zero percentiles for an empty sample', () => {
  expect(summarizeLatency([])).toEqual({ count: 0, p50: 0, p95: 0 })
})
