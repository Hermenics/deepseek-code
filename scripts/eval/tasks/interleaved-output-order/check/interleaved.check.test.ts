import { expect, it } from 'bun:test'
import { collectOutput, diagnoseBuild } from '../repo/src/collector.js'
import { simulateBuildOutput } from '../repo/src/simulator.js'

it('orders merged output by sequence rather than by stream', () => {
  const events = collectOutput(simulateBuildOutput())
  expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5])
  expect(events.map(({ channel }) => channel)).toEqual(['stdout', 'stderr', 'stderr', 'stdout', 'stderr'])
})

it('identifies the earliest causal failure and retains its source channel', () => {
  const firstFailure = diagnoseBuild(simulateBuildOutput()).firstFailure
  expect(firstFailure).toMatchObject({ sequence: 2, channel: 'stderr' })
  expect(firstFailure?.text).toContain('PKG-17')
})

it('sorts arbitrary interleaved records by their deterministic sequence IDs', () => {
  const events = collectOutput({
    stdout: [{ sequence: 9, text: 'later stdout' }, { sequence: 3, text: 'middle stdout' }],
    stderr: [{ sequence: 1, text: 'first stderr' }],
  })
  expect(events.map(({ sequence, channel }) => [sequence, channel])).toEqual([
    [1, 'stderr'], [3, 'stdout'], [9, 'stdout'],
  ])
})
