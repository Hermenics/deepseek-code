import { expect, it } from 'bun:test'
import { collectOutput, diagnoseBuild } from '../src/collector.js'
import { simulateBuildOutput } from '../src/simulator.js'

it('reports the earliest failure in execution order', () => {
  const report = diagnoseBuild(simulateBuildOutput())
  expect(report.firstFailure?.sequence).toBe(2)
  expect(report.firstFailure?.text).toContain('PKG-17')
})

it('preserves channel provenance while interleaving records', () => {
  const events = collectOutput(simulateBuildOutput())
  expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5])
  expect(events.map(({ channel }) => channel)).toEqual(['stdout', 'stderr', 'stderr', 'stdout', 'stderr'])
})
