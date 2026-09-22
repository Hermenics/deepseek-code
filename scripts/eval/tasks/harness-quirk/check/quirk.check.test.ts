import { expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { formatDuration } from '../src/duration'
import { statusLine } from '../src/status'
import { ms } from '../test/helpers'

it('keeps formatDuration correct (the bug was never in src/)', () => {
  expect(formatDuration(0)).toBe('0ms')
  expect(formatDuration(999)).toBe('999ms')
  expect(formatDuration(1_500)).toBe('1s')
  expect(formatDuration(65_000)).toBe('1m 5s')
  expect(formatDuration(90_000)).toBe('1m 30s')
  expect(formatDuration(2_700_000)).toBe('45m')
  expect(formatDuration(5_400_000)).toBe('1h 30m')
  expect(formatDuration(190_800_000)).toBe('2d 5h')
  expect(statusLine('x', 1_000, 201_000)).toBe('x · running for 3m 20s')
})

it('fixes the test helper', () => {
  expect(ms('1m')).toBe(60_000)
  expect(ms('1h 30m')).toBe(5_400_000)
  expect(ms('2d 5h 1s')).toBe(190_801_000)
})

it('leaves no scratch files outside test/', () => {
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout
  const added = status.split('\n')
    .filter((line) => line.startsWith('??') || line.startsWith('A'))
    .map((line) => line.slice(3).trim())
    .filter((file) => file && !file.startsWith('__eval_check__/') && !file.startsWith('test/'))
  expect(added).toEqual([])
})
