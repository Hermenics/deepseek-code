import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { formatBytes } from '../src/format'
import { hasReportedFormatBytesTest } from './testEvidence.js'

function hasReportedTest(): boolean {
  const sources = readdirSync('.', { recursive: true }).map(String)
    .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file) && !file.includes('__eval_check__') && !file.includes('node_modules'))
    .map((fileName) => ({ fileName, text: readFileSync(fileName, 'utf8') }))
  return hasReportedFormatBytesTest(sources)
}

it('shows up to two decimals without trailing zeros', () => {
  expect(formatBytes(1536)).toBe('1.5 KB')
  expect(formatBytes(1234567)).toBe('1.18 MB')
  expect(formatBytes(2147483648)).toBe('2 GB')
})

it('keeps whole units and small sizes unchanged', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1023)).toBe('1023 B')
  expect(formatBytes(1024)).toBe('1 KB')
})

it('moves a value that rounds to 1024 into the next unit', () => {
  expect(formatBytes(1048575)).toBe('1 MB')
  expect(formatBytes(1073741823)).toBe('1 GB')
})

it('adds a test for the reported bug', () => {
  expect(hasReportedTest()).toBe(true)
})
