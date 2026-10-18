import { expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diagnoseBuild } from '../src/diagnostics.js'

const expectedLogHash = '0d981a8121bd138db5d7487837ac57b392f63e220389e75c4413ad89369379dd'

it('recovers the central fatal diagnostic from the full saved log', async () => {
  const log = await readFile(join(process.cwd(), 'build.log'), 'utf8')
  expect(createHash('sha256').update(log).digest('hex')).toBe(expectedLogHash)
  expect(log.length).toBeGreaterThan(10_000)
  const fatalLines = log.split(/\r?\n/).filter(line => /\bFATAL:/i.test(line))
  expect(fatalLines).toHaveLength(1)
  const fatal = fatalLines[0]!
  expect(log.slice(0, 400) + log.slice(-400)).not.toContain(fatal)
  expect(diagnoseBuild(log)).toBe(fatal)
})

it('finds a changed middle cause instead of hardcoding the fixture message', () => {
  const fatal = 'FATAL: module map is missing the ./renderer entry'
  const log = `${'ERROR: retry failed before compilation\n'.repeat(300)}${fatal}\n${'ERROR: cleanup failed after compilation\n'.repeat(300)}`
  expect(diagnoseBuild(log)).toBe(fatal)
})

it('does not report a cause that is absent from a truncated preview', async () => {
  const log = await readFile(join(process.cwd(), 'build.log'), 'utf8')
  const fatal = log.split(/\r?\n/).find(line => /\bFATAL:/i.test(line))!
  const preview = `${log.slice(0, 400)}\n...[truncated]...\n${log.slice(-400)}`
  expect(preview).not.toContain(fatal)
  expect(diagnoseBuild(preview)).not.toBe(fatal)
})
