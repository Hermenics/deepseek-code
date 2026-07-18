import { describe, expect, it } from 'bun:test'
import {
  buildVerifierPrompt,
  formatVerificationForUser,
  parseVerificationResult,
  shouldVerify,
  validateVerificationResult,
} from '../src/tools/SubAgent/verification.js'
import type { SubAgentResult } from '../src/tools/SubAgent/contracts.js'

function result(overrides: Partial<SubAgentResult> = {}): SubAgentResult {
  return { summary: 'Task completed', confidence: 0.9, filesRead: [], filesChanged: [], issuesFound: [], suggestions: [], metadata: {}, ...overrides }
}

describe('fail-closed verification', () => {
  it('selects verification explicitly or for risky low-confidence output', () => {
    expect(shouldVerify('read', result(), true)).toBe(true)
    expect(shouldVerify('fix', result({ confidence: 0.5, filesChanged: ['a.ts'] }))).toBe(true)
    expect(shouldVerify('read', result())).toBe(false)
  })

  it('builds a fresh verifier prompt using candidate data', () => {
    const prompt = buildVerifierPrompt('fix auth', result({ summary: 'Fixed auth', filesChanged: ['src/auth.ts'] }))
    expect(prompt.systemPrompt).not.toContain('fix auth')
    expect(prompt.systemPrompt).not.toContain('Fixed auth')
    expect(prompt.systemPrompt).toContain('submit_verification')
    expect(JSON.parse(prompt.userPayload)).toEqual({
      originalTask: 'fix auth', candidate: { summary: 'Fixed auth', filesChanged: ['src/auth.ts'] },
    })
  })

  it('only confirms schema-valid CONFIRMED output', () => {
    const confirmed = validateVerificationResult({ status: 'CONFIRMED', reason: 'Tests pass', issues: [], evidence: ['bun test'] })
    expect(confirmed.verified).toBe(true)
    expect(validateVerificationResult({ status: 'PLAUSIBLE', reason: 'Not enough evidence', issues: [], evidence: [] }).verified).toBe(false)
    expect(validateVerificationResult({ status: 'REFUTED', reason: 'Test failed', issues: ['regression'], evidence: ['failure'] }).verified).toBe(false)
  })

  it('rejects empty, malformed, Markdown and incomplete verifier output', () => {
    for (const output of ['', 'plain text', '```json\n{}\n```', JSON.stringify({ status: 'CONFIRMED' })]) {
      expect(() => parseVerificationResult(output)).toThrow()
    }
  })

  it('formats the explicit classification', () => {
    const formatted = formatVerificationForUser({ status: 'REFUTED', verified: false, reason: 'Regression', issues: ['failed test'], evidence: [] })
    expect(formatted).toContain('REFUTED')
    expect(formatted).toContain('failed test')
  })
})
