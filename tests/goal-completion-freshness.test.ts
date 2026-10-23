import { expect, it } from 'bun:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { GetGoal } from '../src/tools/GetGoal/GetGoal.js'
import { createGoal, getGoal, setGoal } from '../src/agent/goal.js'
import type { SessionEvidence } from '../src/agent/sessionEvidence.js'

if (process.platform === 'win32' && process.env.CI === 'true') process.env.DEEPSEEK_DEBUG_AGENT_INIT = '1'

type Internals = {
  client: { chat: { completions: { create: (request: Record<string, unknown>) => Promise<unknown> } } }
  sessionEvidence: SessionEvidence
  messages: unknown[]
  refreshProjectContextMessage: () => void
  verifyGoalCompletion: (summary: string) => Promise<string>
}
function extraction(request: Record<string, unknown>) {
  const input = JSON.parse((request.messages as Array<{ content: string }>)[1]!.content)
  if (!Array.isArray(input.sources)) return undefined
  return { choices: [{ message: { content: JSON.stringify({ criteria: input.sources.map((source: { id: string; text: string }) => ({
    text: `Fulfill the fixture requirement from ${source.id}`, source_id: source.id, quote: source.text.slice(0, 1000), verification: 'inspection',
  })) }) } }], usage: {} }
}
function approved(request: Record<string, unknown>, internal: Internals) {
  const input = JSON.parse((request.messages as Array<{ content: string }>)[1]!.content)
  const source = internal.sessionEvidence.toolSources().find(entry => entry.source === 'read_file:acceptance-fixture')!
  return { choices: [{ message: { content: JSON.stringify({ complete: true, explicit_completion: true, coverage_complete: true, reason: 'Fixture covered.', criteria: input.acceptanceCriteria.map((criterion: { id: string }) => ({
    id: criterion.id, status: 'satisfied', reason: 'Fixture observation cited.', evidence: [{ source_id: source.id, quote: source.text }],
  })) }) } }], usage: {} }
}

async function fixture(run: (agent: Agent, internal: Internals, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-goal-freshness-'))
  const agent = new Agent({ provider: 'local', localBaseUrl: 'http://127.0.0.1:65535/v1', localModel: 'fixture' }, { projectRoot: directory })
  try {
    await agent.readyPromise
    createGoal('Implement all requested requirements.')
    ;(agent as unknown as Internals).sessionEvidence.add('tool', 'read_file:acceptance-fixture', 'Fixture implementation and preservation observed.')
    await run(agent, agent as unknown as Internals, directory)
  } finally {
    setGoal(null)
    await agent.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
}

it('reviews complete original constraint sources even after conversation compaction', async () => {
  await fixture(async (_agent, internal) => {
    const requestId = internal.sessionEvidence.add('request', 'original-user', 'Implement A and B; preserve C. api_key=fake-goal-canary')
    const denialId = internal.sessionEvidence.add('denial', 'original-denial', 'Do not publish without approval.')
    internal.messages = []
    let input: Record<string, unknown> | undefined
    internal.client = { chat: { completions: { create: async request => {
      const extracted = extraction(request); if (extracted) return extracted
      input = JSON.parse((request.messages as Array<{ content: string }>)[1]!.content)
      return approved(request, internal)
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result).toMatchObject({ success: true })
    expect(input?.originalSources).toEqual([
      { id: requestId, kind: 'request', source: 'original-user', text: 'Implement A and B; preserve C. api_key=[REDACTED]' },
      { id: denialId, kind: 'denial', source: 'original-denial', text: 'Do not publish without approval.' },
    ])
    expect(input?.workspaceVersion).toHaveProperty('digest')
    expect(JSON.stringify(input)).not.toContain('fake-goal-canary')
  })
})

it('reinjects the active goal after older request previews fall out of session context', async () => {
  await fixture(async (_agent, internal) => {
    createGoal('Complete the whole scoped task; preserve constraints. api_key=fake-goal-context-canary')
    internal.sessionEvidence.add('request', 'original-user', 'Long original request that should fall outside the recent preview.')
    for (let index = 0; index < 8; index++) {
      internal.sessionEvidence.add('request', `later-${index}`, `Unrelated later note ${index}.`)
    }
    internal.sessionEvidence.add('request', 'user-correction', 'Correction: skip the eval and keep all project documentation in English.')
    internal.messages = [{ role: 'system', content: 'You are DeepSeek Code fixture.' }]

    internal.refreshProjectContextMessage()

    const context = internal.messages.find((message): message is { role: string; content: string } =>
      message !== null && message !== undefined && typeof message === 'object' && 'content' in message && typeof (message as { content?: unknown }).content === 'string' &&
      (message as { content: string }).content.includes('<goal-objective>'))
    expect(context).toBeDefined()
    expect(context?.content).toContain('Complete the whole scoped task; preserve constraints.')
    expect(context?.content).toContain('api_key=[REDACTED]')
    expect(context?.content).not.toContain('fake-goal-context-canary')
    expect(context?.content).toContain('Correction: skip the eval and keep all project documentation in English.')
    expect(context?.content).not.toContain('Long original request that should fall outside the recent preview.')
  })
})

it('bounds the goal objective preview without cutting a grapheme', async () => {
  await fixture(async (_agent, internal) => {
    const objective = `${'x'.repeat(3_999)}👩‍👩‍👦${'y'.repeat(2_000)}`
    createGoal(objective)
    internal.refreshProjectContextMessage()

    const context = internal.messages.find((message): message is { role: string; content: string } =>
      message !== null && message !== undefined && typeof message === 'object' && 'content' in message && typeof (message as { content?: unknown }).content === 'string' &&
      (message as { content: string }).content.includes('<goal-objective>'))
    expect(context).toBeDefined()
    expect(context?.content).toContain('[objective preview truncated; get_goal returns the full objective]')
    expect(context?.content).not.toContain('👩‍👩‍👦')
    expect(context?.content).toContain('get_goal returns the full objective')
  })
})

it('rejects an approving reviewer when current workspace files change during the request', async () => {
  await fixture(async (_agent, internal, directory) => {
    await writeFile(join(directory, 'source.ts'), 'original')
    internal.client = { chat: { completions: { create: async request => {
      const extracted = extraction(request); if (extracted) return extracted
      await writeFile(join(directory, 'source.ts'), 'changed by human')
      return approved(request, internal)
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('Workspace changed')
    expect(getGoal()?.status).toBe('active')
  })
})

it('rejects an approving reviewer when original requests or denials change during review', async () => {
  await fixture(async (_agent, internal) => {
    internal.client = { chat: { completions: { create: async request => {
      const extracted = extraction(request); if (extracted) return extracted
      internal.sessionEvidence.add('request', 'later-user', 'Also implement C before finishing.')
      return approved(request, internal)
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('requests or denials changed')
    expect(getGoal()?.status).toBe('active')
  })
})

it('fails closed before a reviewer call when complete source coverage cannot fit the review budget', async () => {
  await fixture(async (_agent, internal) => {
    internal.sessionEvidence.add('request', 'original-user', '😀'.repeat(11_000))
    let calls = 0
    internal.client = { chat: { completions: { create: async request => { calls++; return extraction(request) ?? approved(request, internal) } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('full requirement coverage cannot be verified')
    expect(calls).toBe(0)
    expect(getGoal()?.status).toBe('active')
  })
})

it('bounds historical verification output and rejects a receipt changed during review', async () => {
  await fixture(async (_agent, internal) => {
    internal.sessionEvidence.add('tool', 'verification', JSON.stringify({ status: 'passed', testCount: 3, inputDigest: 'old', output: 'x'.repeat(100_000) }))
    let input: Record<string, unknown> | undefined
    internal.client = { chat: { completions: { create: async request => {
      const extracted = extraction(request); if (extracted) return extracted
      input = JSON.parse((request.messages as Array<{ content: string }>)[1]!.content)
      internal.sessionEvidence.add('tool', 'verification', JSON.stringify({ status: 'failed', testCount: 3 }))
      return approved(request, internal)
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('verification evidence changed')
    const page = input?.historicalVerification as { next: number; totalChars: number }
    expect(page.next).toBeGreaterThan(0)
    expect(page.totalChars).toBeGreaterThan(100_000)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(5_000)
    expect(JSON.stringify(input)).not.toContain('x'.repeat(5_000))
    expect(getGoal()?.status).toBe('active')
  })
})

it('does not ask a reviewer to approve a workspace with an unsafe external source alias', async () => {
  await fixture(async (_agent, internal, directory) => {
    const outside = await mkdtemp(join(tmpdir(), 'deepseek-goal-external-'))
    try {
      await writeFile(join(outside, 'source.ts'), 'outside')
      await symlink(join(outside, 'source.ts'), join(directory, 'alias.ts'))
      let calls = 0
      internal.client = { chat: { completions: { create: async request => { calls++; return extraction(request) ?? approved(request, internal) } } } }
      const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
      expect(result.success).toBe(false)
      expect(calls).toBe(0)
      expect(getGoal()?.status).toBe('active')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })
})


it('reviews current claim states and refuses approval if a refutation changes during review', async () => {
  await fixture(async (_agent, internal) => {
    const source = internal.sessionEvidence.add('tool', 'shell:check', 'One regression remains.')
    const hypothesis = internal.sessionEvidence.recordClaim({ statement: 'All regressions are fixed.', status: 'hypothesis', evidence: [] })
    let input: Record<string, any> | undefined
    internal.client = { chat: { completions: { create: async request => {
      const extracted = extraction(request); if (extracted) return extracted
      input = JSON.parse((request.messages as Array<{ content: string }>)[1]!.content)
      internal.sessionEvidence.recordClaim({ statement: 'All regressions are fixed.', status: 'refuted', supersedes: hypothesis, evidence: [{ id: source, excerpt: 'One regression remains.' }] })
      return approved(request, internal)
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(input?.currentClaims).toEqual([{ id: hypothesis, claim: { statement: 'All regressions are fixed.', status: 'hypothesis', evidence: [] } }])
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('claim state changed')
    expect(getGoal()?.status).toBe('active')
  })
})

it('persists typed criteria and per-item failures, reuses them, and reextracts after a user correction', async () => {
  await fixture(async (agent, internal) => {
    const request = internal.sessionEvidence.add('request', 'user', 'Also preserve the public interface.')
    let extractions = 0
    internal.client = { chat: { completions: { create: async body => {
      const extracted = extraction(body)
      if (extracted) { extractions++; return extracted }
      const response = approved(body, internal)
      const verdict = JSON.parse(response.choices[0]!.message.content)
      verdict.criteria[1].status = 'unverified'
      verdict.criteria[1].reason = 'Public-interface coverage is missing.'
      verdict.criteria[1].evidence = []
      response.choices[0]!.message.content = JSON.stringify(verdict)
      return response
    } } } }
    const first = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(first.success).toBe(false)
    expect(first.verification.criteria[1].status).toBe('unverified')
    expect(getGoal()?.acceptanceCriteria?.items[1]?.source_id).toBe(request)
    expect(getGoal()?.lastAcceptanceReview?.result.complete).toBe(false)
    const reported = JSON.parse(await GetGoal.execute({}))
    expect(reported.goal.acceptanceCriteria.items[1].source_id).toBe(request)
    expect(reported.goal.lastAcceptanceReview.result.criteria[1].status).toBe('unverified')
    const projectContext = agent.getMessages().find(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('<goal-criteria>'))?.content
    expect(typeof projectContext).toBe('string')
    if (typeof projectContext !== 'string') throw new Error('Goal criteria context was not refreshed')
    expect(projectContext).toContain('Extracted acceptance criteria')
    expect(projectContext).toContain(`"source_id":"${request}"`)
    expect(projectContext).toContain('"quote":"Also preserve the public interface."')
    const before = structuredClone(getGoal()!)
    setGoal(JSON.parse(JSON.stringify(before)))
    await internal.verifyGoalCompletion('The whole goal is complete.')
    expect(extractions).toBe(1)
    internal.sessionEvidence.add('request', 'user', 'Correction: also update the usage guide.')
    await internal.verifyGoalCompletion('The whole goal is complete.')
    expect(extractions).toBe(2)
    expect(getGoal()?.acceptanceCriteria?.items).toHaveLength(3)
    expect(getGoal()?.acceptanceCriteria?.sourceFingerprint).not.toBe(before.acceptanceCriteria?.sourceFingerprint)
    expect(getGoal()?.status).toBe('active')
  })
})

it('rejects incomplete criterion coverage even when the reviewer approves globally', async () => {
  await fixture(async (_agent, internal) => {
    internal.sessionEvidence.add('request', 'user', 'Preserve behavior B.')
    internal.client = { chat: { completions: { create: async body => {
      const extracted = extraction(body); if (extracted) return extracted
      const response = approved(body, internal)
      const verdict = JSON.parse(response.choices[0]!.message.content)
      verdict.criteria.pop()
      response.choices[0]!.message.content = JSON.stringify(verdict)
      return response
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('omitted')
    expect(getGoal()?.status).toBe('active')
  })
})

it('does not overwrite requirements changed through the live goal object during extraction', async () => {
  await fixture(async (_agent, internal) => {
    let requests = 0
    internal.client = { chat: { completions: { create: async body => {
      requests++
      getGoal()!.objective = 'A corrected goal that still needs work.'
      return extraction(body)!
    } } } }
    const result = JSON.parse(await internal.verifyGoalCompletion('The whole goal is complete.'))
    expect(result.success).toBe(false)
    expect(result.verification.reason).toContain('changed during criterion extraction')
    expect(requests).toBe(1)
    expect(getGoal()?.objective).toBe('A corrected goal that still needs work.')
    expect(getGoal()?.acceptanceCriteria).toBeUndefined()
    expect(getGoal()?.status).toBe('active')
  })
})
