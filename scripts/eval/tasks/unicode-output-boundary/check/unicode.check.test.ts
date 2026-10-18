import { expect, it } from 'bun:test'
import { makeBuildLog } from '../repo/src/log.js'
import { TRUNCATION_MARKER, truncateOutput } from '../repo/src/output.js'

const EXPECTED_TRUNCATION_MARKER = '\n…[truncated]…\n'
const graphemes = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(({ segment }) => segment)

it('uses a UTF-8 byte budget and preserves the tail error marker', () => {
  const input = makeBuildLog()
  const output = truncateOutput(input, 4096)
  expect(TRUNCATION_MARKER).toBe(EXPECTED_TRUNCATION_MARKER)
  expect(Buffer.from(input, 'utf8').toString('utf8')).toBe(input)
  expect(Buffer.byteLength(input, 'utf8')).toBeGreaterThan(4096)
  expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(4096)
  expect(output).toContain(EXPECTED_TRUNCATION_MARKER)
  expect(output).toContain('ERROR[UTF-8-41]')
  expect(output).toContain('🧪')
  expect(output).not.toContain('\uFFFD')
  expect(Buffer.from(output, 'utf8').toString('utf8')).toBe(output)
})

it('places both retained edges on grapheme boundaries', () => {
  const input = makeBuildLog()
  const output = truncateOutput(input, 4096)
  const markerAt = output.indexOf(EXPECTED_TRUNCATION_MARKER)
  expect(markerAt).toBeGreaterThanOrEqual(0)
  const prefix = output.slice(0, markerAt)
  const suffix = output.slice(markerAt + EXPECTED_TRUNCATION_MARKER.length)
  const inputGraphemes = graphemes(input)
  const prefixGraphemes = graphemes(prefix)
  const suffixGraphemes = graphemes(suffix)
  expect(prefix).toBe(inputGraphemes.slice(0, prefixGraphemes.length).join(''))
  expect(suffix).toBe(inputGraphemes.slice(-suffixGraphemes.length).join(''))
})

it('keeps retained small-cap edges on combining-grapheme boundaries', () => {
  const inputs = [
    `${'x'.repeat(21)}e\u0301${'y'.repeat(40)} ERROR[EDGE-9]`,
    `${'x'.repeat(50)}e\u0301${'y'.repeat(8)} ERROR[EDGE-9]`,
  ]
  for (const input of inputs) {
    const output = truncateOutput(input, 64)
    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(64)
    expect(output).toContain(EXPECTED_TRUNCATION_MARKER)
    expect(output).not.toContain('\uFFFD')
    expect(output).toContain('ERROR[EDGE-9]')
    const markerAt = output.indexOf(EXPECTED_TRUNCATION_MARKER)
    const prefix = output.slice(0, markerAt)
    const suffix = output.slice(markerAt + EXPECTED_TRUNCATION_MARKER.length)
    const inputGraphemes = graphemes(input)
    expect(prefix).toBe(inputGraphemes.slice(0, graphemes(prefix).length).join(''))
    expect(suffix).toBe(inputGraphemes.slice(-graphemes(suffix).length).join(''))
  }
})

it('round-trips the fixture whose byte cap falls inside a surrogate pair', () => {
  const input = `${'a'.repeat(4095)}😀${'b'.repeat(200)} ERROR[PAIR-12]`
  const output = truncateOutput(input, 4096)
  expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(4096)
  expect(Buffer.from(output, 'utf8').toString('utf8')).toBe(output)
  expect(output).toContain('ERROR[PAIR-12]')
})
