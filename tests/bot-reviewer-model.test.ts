import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { createGoal, getGoal, setGoal } from '../src/agent/goal.js'
import type { SessionEvidence } from '../src/agent/sessionEvidence.js'
import { BotStore } from '../src/bots/store.js'

it('persists a validated per-pod reviewer model and supports inheritance', () => {
  const store = new BotStore({ memory: true })
  try {
    const pod = store.createBot({ name: 'reviewer-fixture', projectRoot: process.cwd(), instructions: 'Complete work and report evidence.', reviewerModel: 'quality/reviewer-v1' })
    expect(pod.reviewerModel).toBe('quality/reviewer-v1')
    expect(store.setReviewerModel(pod.id, 'quality/reviewer-v2').reviewerModel).toBe('quality/reviewer-v2')
    expect(store.setReviewerModel(pod.id, 'quality/reviewer-v2').reviewerModel).toBe('quality/reviewer-v2')
    expect(() => store.setReviewerModel(pod.id, 'quality reviewer')).toThrow('model ID')
    expect(() => store.setReviewerModel(pod.id, 'x'.repeat(129))).toThrow('at most 128')
    expect(store.setReviewerModel(pod.id, null).reviewerModel).toBeUndefined()
  } finally { store.close() }
})

it('uses the configured reviewer model for the tool-free mandatory completion check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-pod-reviewer-'))
  const agent = new Agent({ provider: 'local', localBaseUrl: 'http://127.0.0.1:65535/v1', localModel: 'primary-model' }, { projectRoot: directory, goalReviewerModel: 'quality/reviewer-v2' })
  const internal = agent as unknown as {
    readyPromise: Promise<void>
    client: { chat: { completions: { create: (request: Record<string, unknown>) => Promise<unknown> } } }
    sessionEvidence: SessionEvidence
    verifyGoalCompletion: (summary: string) => Promise<string>
  }
  const requests: Array<Record<string, unknown>> = []
  try {
    await internal.readyPromise
    const evidence = internal.sessionEvidence.add('tool', 'read_file:fixture', 'Requested fixture changes observed.')
    internal.client = { chat: { completions: { create: async request => {
      requests.push(request)
      const input = JSON.parse((request.messages as Array<{ content: string }>)[1]!.content)
      const content = input.sources ? { criteria: [{ text: 'Finish every requested item and verify the result.', source_id: 'objective', quote: 'Finish every requested item and verify the result.', verification: 'inspection' }] }
        : { complete: true, explicit_completion: true, coverage_complete: true, reason: 'The fixture evidence covers the requested item.', criteria: [{ id: 'R1', status: 'satisfied', reason: 'Fixture observed.', evidence: [{ source_id: evidence, quote: 'Requested fixture changes observed.' }] }] }
      return { choices: [{ message: { content: JSON.stringify(content) } }], usage: {} }
    } } } }
    setGoal(createGoal('Finish every requested item and verify the result.'))
    const result = JSON.parse(await internal.verifyGoalCompletion('The entire goal is complete; all requested items were implemented and checked.'))
    expect(result.success).toBe(true)
    expect(getGoal()?.status).toBe('complete')
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.model).toBe('quality/reviewer-v2')
      expect(request.tools).toBeUndefined()
    }
  } finally {
    setGoal(null)
    await agent.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
