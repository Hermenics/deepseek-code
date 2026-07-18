import { describe, expect, it } from 'bun:test'
import { OrchestratorSession, runMultiAgentReview, type ReviewFindingInput } from '../src/orchestration/index.js'

const finding = (evidence: string): ReviewFindingInput => ({
  title: 'Race in scheduler', description: 'Two writers share mutable state', impact: 'Workspace corruption',
  file: 'src/scheduler.ts', line: 42, evidence: [evidence],
})

describe('multi-agent review workflow', () => {
  it('normalizes, deduplicates, verifies, classifies and runs a final gap sweep', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, limits: { retryBackoffMs: 0 } })
    const result = await runMultiAgentReview(session, {
      task: 'review scheduler', perspectives: ['correctness', 'security', 'concurrency'],
      async reviewer(perspective) {
        if (perspective === 'security') throw new Error('reviewer unavailable')
        return [finding(`${perspective} evidence`)]
      },
      async verifier(findings) {
        return findings.map(item => ({ findingId: item.findingId, classification: 'CONFIRMED' as const, reason: 'Reproduced independently', evidence: ['deterministic race test'] }))
      },
      async gapSweep(items) {
        return items[0]?.classification === 'CONFIRMED' ? ['No cancellation-path review'] : []
      },
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.perspectives.sort()).toEqual(['concurrency', 'correctness'])
    expect(result.findings[0]?.evidence).toHaveLength(2)
    expect(result.findings[0]?.classification).toBe('CONFIRMED')
    expect(result.reviewerFailures).toEqual([{ perspective: 'security', error: 'reviewer unavailable' }])
    expect(result.verificationAvailable).toBe(true)
    expect(result.gaps).toEqual(['No cancellation-path review'])
  })

  it('fails verification closed while preserving findings and still performs the gap sweep', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, limits: { retryBackoffMs: 0 } })
    let swept = false
    const result = await runMultiAgentReview(session, {
      task: 'review', perspectives: ['correctness'], reviewer: async () => [finding('evidence')],
      verifier: async () => [{ findingId: 'wrong-id', classification: 'CONFIRMED', reason: 'invalid identity', evidence: [] }],
      gapSweep: async () => { swept = true; return [] },
    })
    expect(result.verificationAvailable).toBe(false)
    expect(result.findings[0]?.classification).toBe('PLAUSIBLE')
    expect(result.findings[0]?.verificationError).toContain('Unexpected or duplicate assessment')
    expect(swept).toBe(true)
  })
})
