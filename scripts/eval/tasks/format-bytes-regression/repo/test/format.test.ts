import { expect, it } from 'bun:test'
import { formatBytes } from '../src/format'

it('formats whole units', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1024)).toBe('1 KB')
  expect(formatBytes(1048576)).toBe('1 MB')
})

it('keeps sizes below 1 KB exact', () => {
  expect(formatBytes(1023)).toBe('1023 B')
})
