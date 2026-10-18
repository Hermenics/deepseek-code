import { expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diagnoseBuild } from '../src/diagnostics.js'

it('finds a causal diagnostic in the complete generated log, beyond preview edges', async () => {
  const log = await readFile(join(import.meta.dir, '../build.log'), 'utf8')
  const fatal = log.split(/\r?\n/).find(line => /\bFATAL:/i.test(line))
  expect(log.length).toBeGreaterThan(10_000)
  expect(fatal).toBeDefined()
  expect(log.slice(0, 400) + log.slice(-400)).not.toContain(fatal!)
  expect(diagnoseBuild(log)).toBe(fatal)
})

it('selects a different central failure over noisy edge errors', () => {
  const fatal = 'FATAL: module map is missing the ./renderer entry'
  const log = `${'ERROR: retry failed before compilation\n'.repeat(300)}${fatal}\n${'ERROR: cleanup failed after compilation\n'.repeat(300)}`
  expect(diagnoseBuild(log)).toBe(fatal)
})
