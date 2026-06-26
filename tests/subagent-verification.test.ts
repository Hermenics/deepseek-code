import { describe, test, expect } from 'bun:test'
import {
  shouldVerify,
  buildVerifierPrompt,
  parseVerificationResult,
  formatVerificationForUser,
} from '../src/tools/SubAgent/verification.js'
import type { SubAgentResult } from '../src/tools/SubAgent/contracts.js'

function makeResult(overrides: Partial<SubAgentResult> = {}): SubAgentResult {
  return {
    summary: 'Task completed',
    confidence: 0.9,
    filesRead: [],
    filesChanged: [],
    issuesFound: [],
    suggestions: [],
    metadata: {},
    ...overrides,
  }
}

describe('shouldVerify', () => {
  test('returns true when explicitVerify is true', () => {
    const result = makeResult({ confidence: 0.95 })
    expect(shouldVerify('read file', result, true)).toBe(true)
  })

  test('returns true when confidence < 0.7 and files changed', () => {
    const result = makeResult({ confidence: 0.5, filesChanged: ['src/index.ts'] })
    expect(shouldVerify('fix bug', result)).toBe(true)
  })

  test('returns true when filesChanged is non-empty with low confidence', () => {
    const result = makeResult({ confidence: 0.6, filesChanged: ['a.ts', 'b.ts'] })
    expect(shouldVerify('refactor module', result)).toBe(true)
  })

  test('returns true for tasks with many issues and moderate confidence', () => {
    const result = makeResult({
      confidence: 0.75,
      issuesFound: ['issue1', 'issue2', 'issue3'],
    })
    expect(shouldVerify('security audit', result)).toBe(true)
  })

  test('returns false for simple read tasks with high confidence', () => {
    const result = makeResult({ confidence: 0.95, filesChanged: [] })
    expect(shouldVerify('read the config file', result)).toBe(false)
  })
})

describe('buildVerifierPrompt', () => {
  test('includes original task and result summary', () => {
    const result = makeResult({
      summary: 'Fixed the auth bug',
      confidence: 0.8,
      filesChanged: ['src/auth.ts'],
    })
    const prompt = buildVerifierPrompt('fix auth bug in login', result)
    expect(prompt).toContain('fix auth bug in login')
    expect(prompt).toContain('Fixed the auth bug')
    expect(prompt).toContain('src/auth.ts')
    expect(prompt).toContain('80%')
  })
})

describe('parseVerificationResult', () => {
  test('extracts valid JSON', () => {
    const text = `I checked the files and everything looks good.

\`\`\`json
{
  "verified": true,
  "reason": "All changes are correct",
  "issues": []
}
\`\`\``
    const parsed = parseVerificationResult(text)
    expect(parsed.verified).toBe(true)
    expect(parsed.reason).toBe('All changes are correct')
    expect(parsed.issues).toEqual([])
  })

  test('fallback on bad JSON returns verified true', () => {
    const text = 'No json here, just plain text with no structure'
    const parsed = parseVerificationResult(text)
    expect(parsed.verified).toBe(true)
    expect(parsed.reason).toContain('No structured')
  })
})

describe('formatVerificationForUser', () => {
  test('shows Verified for confirmed result', () => {
    const formatted = formatVerificationForUser({
      verified: true,
      reason: 'All good',
      issues: [],
    })
    expect(formatted).toContain('[Verified]')
    expect(formatted).toContain('All good')
  })

  test('shows Verification Failed for flawed result', () => {
    const formatted = formatVerificationForUser({
      verified: false,
      reason: 'Missing error handling',
      issues: ['no try-catch around fetch'],
    })
    expect(formatted).toContain('[Verification Failed]')
    expect(formatted).toContain('Missing error handling')
    expect(formatted).toContain('no try-catch around fetch')
  })
})
