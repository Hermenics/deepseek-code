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
  it('selects verification explicitly or by action risk', () => {
    expect(shouldVerify(result(), true)).toBe(true)
    expect(shouldVerify(result({ confidence: 0.5, filesChanged: ['a.ts'] }))).toBe(true)
    expect(shouldVerify(result())).toBe(false)
  })

  it('does not let high self-reported confidence skip a risky result', () => {
    // The failure that matters is the agent that is certain and wrong. It
    // reports 0.95, and under the old rule that alone bought it a pass.
    expect(shouldVerify(result({ confidence: 0.95, filesChanged: ['src/auth.ts'] }))).toBe(true)
    expect(shouldVerify(result({ confidence: 1, issuesFound: ['one'] }))).toBe(true)
  })

  it('still pulls in a low-confidence result that changed nothing', () => {
    expect(shouldVerify(result({ confidence: 0.4 }))).toBe(true)
  })

  it('builds a fresh verifier prompt using candidate data', () => {
    const prompt = buildVerifierPrompt('fix auth', result({ summary: 'Fixed auth', filesChanged: ['src/auth.ts'] }), ['git: 1 path(s) changed'])
    expect(prompt.systemPrompt).not.toContain('fix auth')
    expect(prompt.systemPrompt).not.toContain('Fixed auth')
    expect(prompt.systemPrompt).toContain('submit_verification')
    expect(JSON.parse(prompt.userPayload)).toEqual({
      originalTask: 'fix auth',
      // Every claim the candidate made, so the verifier can test the ones
      // that matter rather than only the file list.
      candidate: { summary: 'Fixed auth', filesRead: [], filesChanged: ['src/auth.ts'], issuesFound: [] },
      mechanicalEvidence: ['git: 1 path(s) changed'],
    })
  })

  it('tells the verifier to gather its own evidence rather than trust the summary', () => {
    const prompt = buildVerifierPrompt('fix auth', result(), [])
    expect(prompt.systemPrompt).toContain('read them yourself')
    expect(prompt.systemPrompt).toContain('untrusted data')
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
