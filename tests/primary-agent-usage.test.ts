import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks } from '../src/agent/agent.js'
import { TaskRuntimeError } from '../src/orchestration/lifecycle.js'
import { estimateCost } from '../src/agent/cost.js'
import { AggregateBudgetWarningTracker } from '../src/orchestration/aggregateBudget.js'

async function* stream(chunks: object[]) {
  for (const chunk of chunks) yield chunk
}

function callbacks(): AgentCallbacks {
  return {
    onToken() {},
    onToolCall() {},
    onToolResult() {},
    onDone() {},
  }
}

describe('primary Agent response usage normalization', () => {
  let root: string | undefined
  let agent: Agent | undefined
  let originalNoStream: string | undefined

  afterEach(async () => {
    await agent?.shutdown()
    if (root) await rm(root, { recursive: true, force: true })
    if (originalNoStream === undefined) delete process.env.DEEPSEEK_NO_STREAM
    else process.env.DEEPSEEK_NO_STREAM = originalNoStream
    agent = undefined
    root = undefined
    originalNoStream = undefined
  })

  async function createAgent(
    useStreaming: boolean,
    providerConfig: Exclude<ConstructorParameters<typeof Agent>[0], undefined> = { provider: 'local', localModel: 'test-model' },
  ): Promise<Agent> {
    originalNoStream = process.env.DEEPSEEK_NO_STREAM
    if (useStreaming) delete process.env.DEEPSEEK_NO_STREAM
    else process.env.DEEPSEEK_NO_STREAM = '1'
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-usage-'))
    agent = new Agent(providerConfig, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
    })
    await agent.readyPromise
    return agent
  }

  it('derives streamed totals and reads cached prompt tokens from prompt details', async () => {
    const primaryAgent = await createAgent(true)
    primaryAgent.orchestrator.registry.updateLimits({ maxAggregateTokens: 8 })
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(() => stream([
            { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } },
          ])),
        },
      },
    }

    await primaryAgent.run('Report usage.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 8,
      tokenUsageStatus: 'measured',
      promptTokens: 5,
      completionTokens: 3,
      cachedTokens: 2,
      contextUsage: 5,
    })
    expect(primaryAgent.getAggregateBudgetUsageSnapshot()).toMatchObject({
      limits: { maxAggregateTokens: 8 },
      tokens: 8,
      tokenUsageStatus: 'measured',
    })
    expect(Number.isFinite(primaryAgent.getSessionStats().tokenCount)).toBe(true)
  })

  it('derives non-streamed totals and prefers the direct cache-hit count', async () => {
    const primaryAgent = await createAgent(false)
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
            usage: { prompt_tokens: 4, completion_tokens: 6, prompt_cache_hit_tokens: 1, prompt_tokens_details: { cached_tokens: 3 } },
          })),
        },
      },
    }

    await primaryAgent.run('Report usage.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 10,
      promptTokens: 4,
      completionTokens: 6,
      cachedTokens: 1,
      contextUsage: 4,
    })
    expect(Number.isFinite(primaryAgent.getSessionStats().tokenCount)).toBe(true)
  })

  it('publishes each turn budget group before the model request so notices attach to the new turn', async () => {
    const primaryAgent = await createAgent(false)
    primaryAgent.orchestrator.registry.updateLimits({ maxAggregateTokens: 10 })
    let responseNumber = 0
    let groupAtRequest: string | undefined
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(async () => {
            responseNumber++
            groupAtRequest = primaryAgent.getCurrentAggregateBudgetGroupId()
            const tokens = responseNumber === 1 ? 1 : 9
            return {
              choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
              usage: { total_tokens: tokens, prompt_tokens: tokens - 1, completion_tokens: 1 },
            }
          }),
        },
      },
    }

    await primaryAgent.run('Complete the first turn.', callbacks())
    const previousGroupId = primaryAgent.getCurrentAggregateBudgetGroupId()!
    const notices: string[] = []
    const tracker = new AggregateBudgetWarningTracker()
    let watchedGroupId: string | undefined

    await primaryAgent.run('Complete the second turn.', {
      ...callbacks(),
      onAggregateBudgetGroup(groupId) {
        watchedGroupId = groupId
        tracker.watch(groupId, () => primaryAgent.getAggregateBudgetUsageSnapshot(groupId), warning => notices.push(warning))
      },
    })

    expect(watchedGroupId).toBeDefined()
    expect(watchedGroupId).not.toBe(previousGroupId)
    expect(groupAtRequest).toBe(watchedGroupId)
    expect(tracker.check(watchedGroupId!)).toBe(true)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('aggregate token limit was reached')
  })

  it('notifies once when background usage reaches its original group limit after the main turn ends', async () => {
    const primaryAgent = await createAgent(false)
    primaryAgent.orchestrator.registry.updateLimits({ maxAggregateTokens: 10 })
    let responseNumber = 0
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(async () => {
            responseNumber++
            const tokens = responseNumber === 1 ? 4 : 2
            return {
              choices: [{ finish_reason: 'stop', message: { content: 'done' } }],
              usage: { total_tokens: tokens, prompt_tokens: tokens - 1, completion_tokens: 1 },
            }
          }),
        },
      },
    }

    await primaryAgent.run('Complete the first turn.', callbacks())
    const finishedGroupId = primaryAgent.getCurrentAggregateBudgetGroupId()!
    expect(primaryAgent.getAggregateBudgetUsageSnapshot(finishedGroupId)).toMatchObject({ tokens: 4, tokenUsageStatus: 'measured' })

    const notices: string[] = []
    const tracker = new AggregateBudgetWarningTracker()
    tracker.watch(finishedGroupId, () => primaryAgent.getAggregateBudgetUsageSnapshot(finishedGroupId), notice => notices.push(notice))
    expect(tracker.check(finishedGroupId)).toBe(false)

    let releaseBackground!: () => void
    const backgroundGate = new Promise<void>(resolve => { releaseBackground = resolve })
    const backgroundTask = primaryAgent.orchestrator.registry.spawn({
      taskId: 'late-background-budget-worker',
      budgetGroupId: finishedGroupId,
    }, async ({ signal }) => {
      await Promise.race([
        backgroundGate,
        new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
      ])
      return 'finished'
    })
    while (backgroundTask.status().state !== 'running') await new Promise(resolve => setTimeout(resolve, 0))

    await primaryAgent.run('Complete the next turn.', callbacks())
    const nextGroupId = primaryAgent.getCurrentAggregateBudgetGroupId()!
    expect(nextGroupId).not.toBe(finishedGroupId)
    const nextGroupTokens = primaryAgent.getAggregateBudgetUsageSnapshot(nextGroupId).tokens
    expect(primaryAgent.getAggregateBudgetUsageSnapshot(nextGroupId).tokenUsageStatus).toBe('measured')
    tracker.watch(nextGroupId, () => primaryAgent.getAggregateBudgetUsageSnapshot(nextGroupId), notice => notices.push(notice))

    const lateUsageLease = await primaryAgent.orchestrator.registry.acquireAggregateBudget(finishedGroupId)
    if (!lateUsageLease) throw new Error('Expected the original aggregate budget lease')
    expect(lateUsageLease.maxTokens).toBe(6)
    expect(lateUsageLease.reportUsage({ tokens: 6 })).toEqual({ exceeded: false, exhausted: true, unavailable: false })
    lateUsageLease.release()

    const unsubscribe = primaryAgent.orchestrator.subscribe(event => {
      if (!event.taskId) return
      const record = primaryAgent.orchestrator.registry.getStatus(event.taskId)
      if (record.budgetGroupId) tracker.check(record.budgetGroupId)
    })
    primaryAgent.orchestrator.registry.recordModelUsage('late-background-budget-worker', {
      tokens: 6,
      usageAvailable: true,
      costAvailable: false,
    })

    expect(primaryAgent.getAggregateBudgetUsageSnapshot(finishedGroupId)).toMatchObject({ tokens: 10, tokenUsageStatus: 'measured' })
    expect(primaryAgent.getAggregateBudgetUsageSnapshot(nextGroupId).tokens).toBe(nextGroupTokens)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('10 / 10')
    expect(tracker.check(finishedGroupId)).toBe(false)
    expect(tracker.check(nextGroupId)).toBe(false)
    expect(notices).toHaveLength(1)

    const blockedTask = primaryAgent.orchestrator.registry.spawn({
      taskId: 'unmeasured-background-budget-worker',
      budgetGroupId: nextGroupId,
    }, async () => {
      throw new TaskRuntimeError('AGGREGATE_BUDGET_UNAVAILABLE', 'Provider usage could not be measured')
    })
    await blockedTask.awaitResult()
    expect(primaryAgent.getAggregateBudgetUsageSnapshot(nextGroupId)).toMatchObject({ blocked: true })
    expect(notices).toHaveLength(2)
    expect(notices[1]).toContain('some usage is unavailable')
    expect(tracker.check(nextGroupId)).toBe(false)
    expect(notices).toHaveLength(2)
    unsubscribe()

    releaseBackground()
    await backgroundTask.awaitResult()
  })

  it('includes prompt-refinement usage in session and aggregate-turn metrics', async () => {
    const primaryAgent = await createAgent(true)
    primaryAgent.setPromptRefinerEnabled(true)
    primaryAgent.orchestrator.registry.updateLimits({ maxAggregateTokens: 100 })
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock((request: Record<string, any>) => {
            if (request.stream) {
              return stream([
                { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
                { choices: [], usage: { total_tokens: 8, prompt_tokens: 5, completion_tokens: 3 } },
              ])
            }
            return Promise.resolve({
              choices: [{ finish_reason: 'stop', message: { content: 'SKIP' } }],
              usage: { total_tokens: 2, prompt_tokens: 1, completion_tokens: 1 },
            })
          }),
        },
      },
    }

    await primaryAgent.run('Please explain this request in clearer terms before carrying it out.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 10,
      tokenUsageStatus: 'measured',
    })
    expect(primaryAgent.getAggregateBudgetUsageSnapshot()).toMatchObject({
      tokens: 10,
      tokenUsageStatus: 'measured',
    })
  })

  it('prices prompt-refinement usage with its configured model', async () => {
    const primaryAgent = await createAgent(false, { provider: 'deepseek', model: 'deepseek-flash', apiKey: 'test-key' })
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [{ finish_reason: 'stop', message: { content: 'SKIP' } }],
            usage: { total_tokens: 200_000, prompt_tokens: 100_000, completion_tokens: 100_000 },
          })),
        },
      },
    }
    const body = { model: 'deepseek-v4-pro', messages: [], max_tokens: 1 }

    await (primaryAgent as any).getBudgetedCompletionClient().chat.completions.create(body)

    const usage = {
      promptTokens: 100_000,
      completionTokens: 100_000,
      cachedTokens: 0,
    }
    expect(primaryAgent.getSessionStats().costUsd).toBeGreaterThan(estimateCost('deepseek-flash', usage))
  })

  it('reports usage as unavailable when the provider omits token counts', async () => {
    const primaryAgent = await createAgent(true)
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(() => stream([
            { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
          ])),
        },
      },
    }

    await primaryAgent.run('Report usage.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 0,
      tokenUsageStatus: 'unavailable',
      costUsd: 0,
      costUsageStatus: 'unavailable',
      costEstimated: false,
    })
    expect(primaryAgent.getAggregateBudgetUsageSnapshot()).toMatchObject({
      tokens: 0,
      tokenUsageStatus: 'unavailable',
      costUsd: 0,
      costUsageStatus: 'unavailable',
    })
  })

  it('does not count malformed negative token usage as measured', async () => {
    const primaryAgent = await createAgent(true)
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(() => stream([
            { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
            { choices: [], usage: { total_tokens: -3, prompt_tokens: -5, completion_tokens: 2, prompt_cache_hit_tokens: -1 } },
          ])),
        },
      },
    }

    await primaryAgent.run('Report usage.', callbacks())

    expect(primaryAgent.getSessionStats()).toMatchObject({
      tokenCount: 0,
      tokenUsageStatus: 'unavailable',
      promptTokens: 0,
      completionTokens: 2,
      cachedTokens: 0,
    })
  })

  it('reports a known partial subagent token subtotal as partial rather than unavailable', async () => {
    const primaryAgent = await createAgent(true)
    const groupId = 'partial-usage-turn'
    ;(primaryAgent as any).turnBudgetGroupId = groupId
    const task = primaryAgent.orchestrator.registry.spawn({ taskId: 'partial-usage-worker', budgetGroupId: groupId }, async () => 'done')
    await task.awaitResult()

    primaryAgent.orchestrator.registry.recordModelUsage('partial-usage-worker', {
      tokens: 5, costUsd: 0.001, usageAvailable: true, costAvailable: true,
    })
    primaryAgent.orchestrator.registry.recordModelUsage('partial-usage-worker', {
      tokens: 0, costUsd: 0, usageAvailable: false, costAvailable: false,
    })

    expect(primaryAgent.getSessionStats()).toMatchObject({ tokenCount: 5, tokenUsageStatus: 'partial' })
    expect(primaryAgent.getAggregateBudgetUsageSnapshot()).toMatchObject({ tokens: 5, tokenUsageStatus: 'partial' })
  })

  it('keeps measured token usage separate when only the aggregate cost budget is unavailable', async () => {
    const primaryAgent = await createAgent(true)
    const groupId = 'cost-unavailable-turn'
    ;(primaryAgent as any).turnBudgetGroupId = groupId
    const task = primaryAgent.orchestrator.registry.spawn({ taskId: 'cost-unavailable-worker', budgetGroupId: groupId }, async () => {
      primaryAgent.orchestrator.registry.recordModelUsage('cost-unavailable-worker', {
        tokens: 5, costUsd: 0, usageAvailable: true, costAvailable: false,
      })
      throw new TaskRuntimeError('AGGREGATE_BUDGET_UNAVAILABLE', 'Cost usage is unavailable')
    })
    await task.awaitResult()

    expect(primaryAgent.getAggregateBudgetUsageSnapshot()).toMatchObject({
      tokens: 5,
      tokenUsageStatus: 'measured',
      costUsd: 0,
      costUsageStatus: 'unavailable',
      blocked: true,
    })
  })

  it('marks usage unavailable when an aggregate-blocked child has no measured metrics', async () => {
    const primaryAgent = await createAgent(true)
    const groupId = 'unmeasured-blocked-turn'
    ;(primaryAgent as any).turnBudgetGroupId = groupId
    const task = primaryAgent.orchestrator.registry.spawn({ taskId: 'unmeasured-blocked-worker', budgetGroupId: groupId }, async () => {
      throw new TaskRuntimeError('AGGREGATE_BUDGET_UNAVAILABLE', 'Prior usage could not be measured')
    })
    await task.awaitResult()

    expect(primaryAgent.getAggregateBudgetUsageSnapshot()).toMatchObject({
      tokens: 0,
      tokenUsageStatus: 'unavailable',
      costUsd: 0,
      costUsageStatus: 'unavailable',
      blocked: true,
    })
  })

  it('surfaces a proxy error separately from assistant output for structured pipe callers', async () => {
    const primaryAgent = await createAgent(true)
    ;(primaryAgent as any).client = {
      chat: {
        completions: {
          create: mock(() => stream([{ error: { message: 'upstream unavailable' }, choices: [] }])),
        },
      },
    }
    const providerErrors: string[] = []

    await primaryAgent.run('Report status.', {
      ...callbacks(),
      onProviderError(message) { providerErrors.push(message) },
    })

    expect(providerErrors).toEqual(['upstream unavailable'])
  })
})
