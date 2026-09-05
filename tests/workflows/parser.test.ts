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
    expect(() => parseWorkflowSource('export const meta = { name: }; return 1')).toThrow('plain object literal')
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

describe('JavaScript meta literals', () => {
  test('accepts the idiomatic literal every caller actually writes', () => {
    const parsed = parseWorkflowSource([
      "export const meta = {",
      "  name: 'color-check',",
      "  description: 'Return one word per agent',",
      "  phases: [{ title: 'Alpha' }, { title: 'Beta', detail: 'second' }],",
      "}",
      "phase('Alpha')",
    ].join('\n'))
    expect(parsed.meta.name).toBe('color-check')
    expect(parsed.meta.description).toBe('Return one word per agent')
    expect(parsed.meta.phases?.map(phase => phase.title)).toEqual(['Alpha', 'Beta'])
    expect(parsed.body.trim()).toBe("phase('Alpha')")
  })

  test('keeps accepting strict JSON so saved workflows still load', () => {
    const parsed = parseWorkflowSource('export const meta = {"name":"json-form"};\nphase("A")')
    expect(parsed.meta.name).toBe('json-form')
  })

  test('a closing brace inside a single-quoted string does not end the object', () => {
    const parsed = parseWorkflowSource("export const meta = { name: 'brace', description: 'a } b' }\nphase('A')")
    expect(parsed.meta.description).toBe('a } b')
    expect(parsed.body.trim()).toBe("phase('A')")
  })

  test('the literal is evaluated with no capability, so a call is rejected', () => {
    expect(() => parseWorkflowSource("export const meta = { name: process.exit(1) }\nphase('A')"))
      .toThrow('Workflow metadata must be a plain object literal')
  })

  test('rejects calls, spreads and template interpolation in metadata', () => {
    const invalid = [
      "export const meta = { name: String('called') }; return 1",
      "export const meta = { name: 'spread', ...{ description: 'dynamic' } }; return 1",
      "export const meta = { name: 'assign', description: Object.assign({}, { value: 'dynamic' }) }; return 1",
      "export const meta = { name: 'interpolated', description: `${'dynamic'}` }; return 1",
      "export const meta = { ['name']: 'computed' }; return 1",
    ]
    for (const source of invalid) expect(() => parseWorkflowSource(source)).toThrow('Workflow metadata must be a plain object literal')
  })

  test('rejects excessively nested metadata with the validation error', () => {
    const depth = 200
    const source = `export const meta = { name: 'deep', nested: ${'['.repeat(depth)}0${']'.repeat(depth)} }; return 1`

    expect(() => parseWorkflowSource(source)).toThrow('Workflow metadata must be a plain object literal')
  })
})
