import { describe, expect, test } from 'bun:test'
import { formatWorkflowSource, parseWorkflowSource } from '../../src/workflows/parser.js'

const MAX_SOURCE_BYTES = 256 * 1024

describe('workflow source parser', () => {
  test('extracts JSON metadata and keeps the executable body', () => {
    const parsed = parseWorkflowSource(`
      export const meta = {"name":"review-code","description":"Review code"};
      const value = await agent("inspect");
      return value;
    `)

    expect(parsed.meta).toEqual({ name: 'review-code', description: 'Review code' })
    expect(parsed.body).toContain('await agent("inspect")')
    expect(parsed.body).not.toContain('export const meta')
  })

  test('allows an ad-hoc script with an explicit fallback name', () => {
    const parsed = parseWorkflowSource('return args.value;', 'ad-hoc')
    expect(parsed.meta.name).toBe('ad-hoc')
  })

  test('rejects malformed metadata and names', () => {
    expect(() => parseWorkflowSource('export const meta = { name: "bad" }; return 1')).toThrow('JSON-compatible')
    expect(() => parseWorkflowSource('export const meta = {"name":"Bad Name"}; return 1')).toThrow('Invalid workflow name')
  })

  test('enforces the source-size boundary', () => {
    const prefix = 'return 1;'
    expect(parseWorkflowSource(prefix + ' '.repeat(MAX_SOURCE_BYTES - prefix.length), 'boundary').meta.name).toBe('boundary')
    expect(() => parseWorkflowSource(prefix + ' '.repeat(MAX_SOURCE_BYTES - prefix.length + 1), 'oversized')).toThrow(`exceeds ${MAX_SOURCE_BYTES} bytes`)
  })

  test('reports an unclosed metadata object', () => {
    expect(() => parseWorkflowSource('export const meta = {"name":"unclosed"')).toThrow('Workflow metadata object is not closed')
  })

  test('round-trips formatted metadata and executable code', () => {
    const body = 'const value = await agent("inspect");\nreturn value;'
    const parsed = parseWorkflowSource(formatWorkflowSource({ name: 'round-trip', description: 'Round trip' }, body))
    expect(parsed.meta).toEqual({ name: 'round-trip', description: 'Round trip' })
    expect(parsed.body.trim()).toBe(body)
  })
})
