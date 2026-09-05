import { describe, expect, test } from 'bun:test'
import { parseToolCallArguments } from '../src/agent/agent.js'
import { truncateShellOutput } from '../src/tools/Shell/Shell.js'
import { collectEnvironmentInfo, formatEnvironmentInfo } from '../src/agent/environment.js'

const call = (args: string) => ({ id: 'call-1', type: 'function' as const, function: { name: 'write_file', arguments: args } })

describe('parseToolCallArguments', () => {
  test('parses a JSON object and treats an empty payload as no arguments', () => {
    expect(parseToolCallArguments(call('{"path":"a.ts","content":"x"}'), 'tool_calls')).toEqual({
      tc: call('{"path":"a.ts","content":"x"}'), parsedArgs: { path: 'a.ts', content: 'x' },
    })
    expect(parseToolCallArguments(call('   '), null).parsedArgs).toEqual({})
  })

  test('explains a response cut off at the output-token limit instead of executing {}', () => {
    const parsed = parseToolCallArguments(call('{"path":"a.ts","content":"const x = '), 'length')
    expect(parsed.parsedArgs).toEqual({})
    expect(parsed.parseError).toContain('cut off at the output-token limit')
    expect(parsed.parseError).toContain("'write_file'")
    expect(parsed.parseError).toContain('Nothing was executed')
    expect(parsed.parseError).toContain('Split the work')
  })

  test('reports malformed JSON and non-object payloads as actionable errors', () => {
    expect(parseToolCallArguments(call('{"path": }'), 'stop').parseError).toContain('not valid JSON')
    expect(parseToolCallArguments(call('["a.ts"]'), 'stop').parseError).toContain('received an array')
    expect(parseToolCallArguments(call('"a.ts"'), 'stop').parseError).toContain('received string')
  })
})

describe('truncateShellOutput', () => {
  test('keeps the head and the tail so the final verdict of a long run survives', () => {
    const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index}`)
    const output = [...lines, 'FAIL: 3 tests failed'].join('\n')
    const truncated = truncateShellOutput(output, 2_000)
    expect(truncated.length).toBeLessThan(2_300)
    expect(truncated.startsWith('line 0\nline 1')).toBe(true)
    expect(truncated.endsWith('FAIL: 3 tests failed')).toBe(true)
    expect(truncated).toContain('characters truncated')
    expect(truncateShellOutput('short', 2_000)).toBe('short')
  })
})

describe('environment context', () => {
  test('renders the facts the model otherwise has to discover with tool calls', async () => {
    const info = await collectEnvironmentInfo({
      workingDirectory: process.cwd(), additionalDirectories: ['/tmp/extra'], model: 'deepseek-v4-flash', provider: 'deepseek',
      now: new Date('2026-09-05T12:00:00Z'),
    })
    const text = formatEnvironmentInfo(info)
    expect(text).toContain(`Working directory: ${process.cwd()}`)
    expect(text).toContain('Additional working directories: /tmp/extra')
    expect(text).toContain('Is a git repository: yes')
    expect(text).toContain(`Platform: ${process.platform}`)
    expect(text).toContain('Model: deepseek-v4-flash via deepseek')
    expect(text).toContain("Today's date: 2026-09-05")
    expect(info.shell.length).toBeGreaterThan(0)
  })
})
