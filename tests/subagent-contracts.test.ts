import { describe, it, expect } from 'bun:test'
import { parseSubAgentResult, formatResultForParent } from '../src/tools/SubAgent/contracts'
import type { SubAgentResult } from '../src/tools/SubAgent/contracts'

describe('parseSubAgentResult', () => {
  it('extracts JSON from markdown code block', () => {
    const text = `Here is my analysis:

\`\`\`json
{
  "summary": "Found 2 bugs",
  "confidence": 0.9,
  "filesRead": ["src/index.ts"],
  "filesChanged": ["src/fix.ts"],
  "issuesFound": ["null ref"],
  "suggestions": ["add guard"],
  "metadata": {"tool": "lint"}
}
\`\`\``

    const result = parseSubAgentResult(text)
    expect(result.summary).toBe('Found 2 bugs')
    expect(result.confidence).toBe(0.9)
    expect(result.filesRead).toEqual(['src/index.ts'])
    expect(result.filesChanged).toEqual(['src/fix.ts'])
    expect(result.issuesFound).toEqual(['null ref'])
    expect(result.suggestions).toEqual(['add guard'])
    expect(result.metadata).toEqual({ tool: 'lint' })
  })

  it('extracts the last JSON block when multiple exist', () => {
    const text = `\`\`\`json
{"summary": "first"}
\`\`\`

Some text in between.

\`\`\`json
{"summary": "second", "confidence": 0.8, "filesRead": [], "filesChanged": [], "issuesFound": [], "suggestions": [], "metadata": {}}
\`\`\``

    const result = parseSubAgentResult(text)
    expect(result.summary).toBe('second')
    expect(result.confidence).toBe(0.8)
  })

  it('fallback: wraps plain text as summary with confidence 0.5', () => {
    const text = 'No JSON here, just plain analysis text.'
    const result = parseSubAgentResult(text)
    expect(result.summary).toBe('No JSON here, just plain analysis text.')
    expect(result.confidence).toBe(0.5)
    expect(result.filesRead).toEqual([])
    expect(result.filesChanged).toEqual([])
    expect(result.issuesFound).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(result.metadata).toEqual({})
  })

  it('handles malformed JSON gracefully', () => {
    const text = `\`\`\`json
{not valid json at all
\`\`\``

    const result = parseSubAgentResult(text)
    expect(result.summary).toBe(text.slice(0, 200))
    expect(result.confidence).toBe(0.5)
    expect(result.filesRead).toEqual([])
  })

  it('clamps confidence to [0, 1]', () => {
    const text = `\`\`\`json
{"summary": "test", "confidence": 5.0}
\`\`\``
    expect(parseSubAgentResult(text).confidence).toBe(1)

    const text2 = `\`\`\`json
{"summary": "test", "confidence": -2}
\`\`\``
    expect(parseSubAgentResult(text2).confidence).toBe(0)
  })
})

describe('validateResult', () => {
  // The module doesn't export a validateResult function, but based on the task
  // we validate via parseSubAgentResult's type guarantees and structure checks.

  it('accepts valid SubAgentResult structure', () => {
    const text = `\`\`\`json
{
  "summary": "All good",
  "confidence": 0.95,
  "filesRead": ["a.ts", "b.ts"],
  "filesChanged": ["c.ts"],
  "issuesFound": [],
  "suggestions": ["consider caching"],
  "metadata": {"duration": 120}
}
\`\`\``

    const result = parseSubAgentResult(text)
    expect(result.summary).toBe('All good')
    expect(result.confidence).toBe(0.95)
    expect(result.filesRead).toEqual(['a.ts', 'b.ts'])
    expect(result.filesChanged).toEqual(['c.ts'])
    expect(result.issuesFound).toEqual([])
    expect(result.suggestions).toEqual(['consider caching'])
    expect(result.metadata).toEqual({ duration: 120 })
  })

  it('rejects missing fields by using defaults', () => {
    const text = `\`\`\`json
{"summary": "partial"}
\`\`\``

    const result = parseSubAgentResult(text)
    // Missing fields get safe defaults rather than throwing
    expect(result.summary).toBe('partial')
    expect(result.confidence).toBe(0.5)
    expect(result.filesRead).toEqual([])
    expect(result.filesChanged).toEqual([])
    expect(result.issuesFound).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(result.metadata).toEqual({})
  })
})

describe('formatResultForParent', () => {
  it('includes summary, confidence, files, and issues', () => {
    const result: SubAgentResult = {
      summary: 'Fixed the auth bug',
      confidence: 0.85,
      filesRead: ['src/auth.ts'],
      filesChanged: ['src/auth.ts', 'src/middleware.ts'],
      issuesFound: ['token expiry not checked'],
      suggestions: ['add refresh token logic'],
      metadata: {},
    }

    const output = formatResultForParent(result)
    expect(output).toContain('Fixed the auth bug')
    expect(output).toContain('Files changed: src/auth.ts, src/middleware.ts')
    expect(output).toContain('Issues: token expiry not checked')
    expect(output).toContain('Suggestions: add refresh token logic')
    expect(output).toContain('Confidence: 85%')
  })

  it('omits sections when arrays are empty', () => {
    const result: SubAgentResult = {
      summary: 'Looks clean',
      confidence: 1,
      filesRead: [],
      filesChanged: [],
      issuesFound: [],
      suggestions: [],
      metadata: {},
    }

    const output = formatResultForParent(result)
    expect(output).toContain('Looks clean')
    expect(output).toContain('Confidence: 100%')
    expect(output).not.toContain('Files changed')
    expect(output).not.toContain('Issues')
    expect(output).not.toContain('Suggestions')
  })
})
