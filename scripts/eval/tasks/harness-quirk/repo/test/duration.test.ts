import { expect, it } from 'bun:test'
import { formatDuration } from '../src/duration'
import { statusLine } from '../src/status'
import { ms } from './helpers'

it('shows milliseconds under a second', () => {
  expect(formatDuration(0)).toBe('0ms')
  expect(formatDuration(999)).toBe('999ms')
})

it('shows the two largest units', () => {
  expect(formatDuration(1_500)).toBe('1s')
  expect(formatDuration(90_000)).toBe('1m 30s')
  expect(formatDuration(ms('2d 5h'))).toBe('2d 5h')
})

it('round-trips the shorthand', () => {
  expect(formatDuration(ms('1h 30m'))).toBe('1h 30m')
  expect(formatDuration(ms('45m'))).toBe('45m')
  expect(formatDuration(ms('1m 5s'))).toBe('1m 5s')
})

it('builds the status line', () => {
  expect(statusLine('build', 0, ms('3m 20s'))).toBe('build · running for 3m 20s')
})
