import { expect, it } from 'bun:test'
import { makeBuildLog } from '../src/log.js'
import { TRUNCATION_MARKER, truncateOutput } from '../src/output.js'

it('bounds long output by UTF-8 bytes and retains its diagnostic tail', () => {
  const log = makeBuildLog()
  const output = truncateOutput(log, 4096)
  expect(Buffer.byteLength(log, 'utf8')).toBeGreaterThan(4096)
  expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(4096)
  expect(output).toContain(TRUNCATION_MARKER)
  expect(output).toContain('ERROR[UTF-8-41]')
})
