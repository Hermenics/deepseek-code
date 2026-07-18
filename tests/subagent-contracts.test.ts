import { describe, expect, it } from 'bun:test'
import {
  formatResultForParent,
  parseSubAgentResult,
  StructuredOutputError,
  validateSubAgentResult,
  type SubAgentResult,
} from '../src/tools/SubAgent/contracts.js'

const valid: SubAgentResult = {
  summary: 'Found two bugs', confidence: 0.9,
  filesRead: ['src/index.ts'], filesChanged: [], issuesFound: ['null ref'], suggestions: ['add guard'], metadata: {},
}

describe('strict subagent result contract', () => {
  it('accepts exactly one complete schema-valid JSON value', () => {
    expect(parseSubAgentResult(JSON.stringify(valid))).toEqual(valid)
    expect(validateSubAgentResult(valid)).toEqual(valid)
  })

  it('rejects Markdown extraction, malformed JSON and missing fields', () => {
    for (const value of [`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, '{bad', JSON.stringify({ summary: 'partial' })]) {
      expect(() => parseSubAgentResult(value)).toThrow(StructuredOutputError)
    }
  })

  it('rejects out-of-range confidence and non-string arrays', () => {
    expect(() => validateSubAgentResult({ ...valid, confidence: 2 })).toThrow('Invalid subagent result')
    expect(() => validateSubAgentResult({ ...valid, filesRead: [42] })).toThrow('Invalid subagent result')
  })

  it('formats only present result sections', () => {
    const output = formatResultForParent(valid)
    expect(output).toContain('Found two bugs')
    expect(output).toContain('Issues: null ref')
    expect(output).toContain('Confidence: 90%')
    expect(output).not.toContain('Files changed')
  })
})
