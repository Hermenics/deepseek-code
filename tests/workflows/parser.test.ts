import { describe, expect, test } from 'bun:test'
import { parseWorkflowSource } from '../../src/workflows/parser.js'

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
})
