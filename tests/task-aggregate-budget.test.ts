import { describe, expect, it } from 'bun:test'
import { OrchestratorSession, TaskRegistry } from '../src/orchestration/index.js'
import { runSubAgentLoop } from '../src/tools/SubAgent/executor.js'
import { validateSettings } from '../src/settings/repository.js'
import { estimateCost } from '../src/agent/cost.js'

const provider = { provider: 'local' as const, localModel: 'fake' }

describe('aggregate worker budgets', () => {
  it('serializes requests within a budget group and passes only the remaining allowance', async () => {
    const registry = new TaskRegistry({
      projectRoot: process.cwd(),
      limits: { maxAggregateTokens: 10, maxAggregateCostUsd: 1 },
    })
    const first = await registry.acquireAggregateBudget('turn')
    if (!first) throw new Error('Expected an aggregate budget lease')
    const secondPending = registry.acquireAggregateBudget('turn')
    const unrelated = await registry.acquireAggregateBudget('other')
    if (!unrelated) throw new Error('Expected an aggregate budget lease')
    expect(first.maxTokens).toBe(10)
    expect(first.maxCostUsd).toBe(1)
    expect(unrelated.maxTokens).toBe(10)
    unrelated.release()

    let secondAcquired = false
    void secondPending.then(() => { secondAcquired = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(secondAcquired).toBe(false)
    expect(first.reportUsage({ tokens: 6, costUsd: 0.25 })).toEqual({ exceeded: false, exhausted: false, unavailable: false })
    first.release()

    const second = await secondPending
    if (!second) throw new Error('Expected an aggregate budget lease')
    expect(second.maxTokens).toBe(4)
    expect(second.maxCostUsd).toBeCloseTo(0.75)
    expect(second.reportUsage({ tokens: 4, costUsd: 0.75 })).toEqual({ exceeded: false, exhausted: true, unavailable: false })
    second.release()
    await expect(registry.acquireAggregateBudget('turn')).rejects.toMatchObject({ code: 'AGGREGATE_BUDGET_EXHAUSTED' })
  })

  it('removes an aborted waiter without stranding the group lock', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { maxAggregateTokens: 10 } })
    const first = await registry.acquireAggregateBudget('turn')
    if (!first) throw new Error('Expected an aggregate budget lease')
    const controller = new AbortController()
    const cancelled = registry.acquireAggregateBudget('turn', controller.signal)
    controller.abort(new Error('cancelled while waiting'))
    await expect(cancelled).rejects.toThrow('cancelled while waiting')
    first.release()
    const next = await registry.acquireAggregateBudget('turn')
    if (!next) throw new Error('Expected an aggregate budget lease')
    expect(next.maxTokens).toBe(10)
    next.release()
  })

  it('makes child tasks inherit the parent group and refuses a child override', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { concurrency: 2 } })
    const parent = registry.spawn({ taskId: 'parent', budgetGroupId: 'turn', allowDelegation: true }, ({ signal }) => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    while (parent.status().state !== 'running') await new Promise(resolve => setTimeout(resolve, 0))
    expect(() => registry.spawn({ taskId: 'wrong-group', parentTaskId: 'parent', budgetGroupId: 'other' }, async () => 'no')).toThrow('inherit its parent')
    const child = registry.spawn({ taskId: 'child', parentTaskId: 'parent' }, async context => context.budgetGroupId)
    expect(child.status().budgetGroupId).toBe('turn')
    expect((await child.awaitResult()).value).toBe('turn')
    parent.cancel()
    await parent.awaitResult()
  })

  it('reconstructs one legacy group for a nested snapshot regardless of record order', async () => {
    const source = new TaskRegistry({ sessionId: 'legacy-budget', projectRoot: process.cwd(), limits: { concurrency: 1, maxDepth: 4 } })
    const root = source.spawn({ taskId: 'root', allowDelegation: true, maxDepth: 4 }, ({ signal }) => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    while (root.status().state !== 'running') await new Promise(resolve => setTimeout(resolve, 0))
    source.spawn({ taskId: 'child', parentTaskId: 'root', allowDelegation: true }, async () => 'unused')
    source.spawn({ taskId: 'grandchild', parentTaskId: 'child' }, async () => 'unused')
    const legacy = ['grandchild', 'child', 'root'].map(taskId => {
      const record = source.getStatus(taskId)
      delete (record as any).budgetGroupId
      return record
    })
    const restored = new TaskRegistry({ sessionId: 'legacy-budget', projectRoot: process.cwd() })
    restored.restoreTasks(legacy)
    expect(restored.listTasks().map(record => record.budgetGroupId)).toEqual(['root', 'root', 'root'])
    root.cancel()
    await source.awaitIdle()
  })

  it('serializes sibling model requests and stops before an exhausted group can make another request', async () => {
    const session = new OrchestratorSession({
      projectRoot: process.cwd(),
      logFile: null,
      snapshotFile: null,
      limits: { concurrency: 2, maxAggregateTokens: 10 },
    })
    const bodies: Array<Record<string, any>> = []
    let activeRequests = 0
    let maxActiveRequests = 0
    const client = { chat: { completions: { create: async (body: Record<string, any>) => {
      bodies.push(body)
      activeRequests++
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await new Promise(resolve => setTimeout(resolve, 5))
      activeRequests--
      const tokens = body.max_tokens === 10 ? 6 : 4
      return {
        choices: [{ message: { content: 'done' } }],
        usage: { total_tokens: tokens, prompt_tokens: tokens - 2, completion_tokens: 2 },
      }
    } } } } as any
    const spawn = (taskId: string) => session.spawn({ taskId, budgetGroupId: 'turn', maxRetries: 0 }, context => runSubAgentLoop(
      'system', 'task', taskId, [], provider, 'fake', {
        client,
        context: session.toolContext({ taskId, signal: context.signal, budgetGroupId: context.budgetGroupId }),
      },
    ))

    try {
      const siblings = [spawn('worker-a'), spawn('worker-b')]
      const results = await Promise.all(siblings.map(task => task.awaitResult()))
      expect(results.map(result => result.status)).toEqual(['done', 'done'])
      expect(bodies.map(body => body.max_tokens)).toEqual([10, 4])
      expect(maxActiveRequests).toBe(1)

      const extra = await spawn('worker-c').awaitResult()
      expect(extra.status).toBe('failed')
      expect(extra.error?.code).toBe('AGGREGATE_BUDGET_EXHAUSTED')
      expect(bodies).toHaveLength(2)
    } finally {
      await session.shutdown()
    }
  })

  it('rejects invalid aggregate settings at the settings boundary', () => {
    const issues = validateSettings({ agents: { maxAggregateTokens: 0, maxAggregateCostUsd: -1 } })
    expect(issues.map(issue => issue.path)).toContain('agents.maxAggregateTokens')
    expect(issues.map(issue => issue.path)).toContain('agents.maxAggregateCostUsd')
    expect(validateSettings({ agents: { maxAggregateTokens: 100, maxAggregateCostUsd: 1 } })).toEqual([])
  })

  it('caps output by remaining estimated cost and blocks another call below one output token', async () => {
    const deepseek = { provider: 'deepseek' as const, baseURL: 'https://api.deepseek.com' }
    const costPerToken = estimateCost('deepseek-flash', { promptTokens: 0, completionTokens: 1, cachedTokens: 0 })
    const session = new OrchestratorSession({
      projectRoot: process.cwd(), logFile: null, snapshotFile: null,
      limits: { concurrency: 2, maxAggregateCostUsd: costPerToken * 2.8 },
    })
    const bodies: Array<Record<string, any>> = []
    const client = { chat: { completions: { create: async (body: Record<string, any>) => {
      bodies.push(body)
      return { choices: [{ message: { content: 'done' } }], usage: { total_tokens: 1, prompt_tokens: 0, completion_tokens: 1 } }
    } } } } as any
    const spawn = (taskId: string) => session.spawn({ taskId, budgetGroupId: 'cost-turn', maxRetries: 0 }, context => runSubAgentLoop(
      'system', 'task', taskId, [], deepseek, 'deepseek-flash', {
        client,
        context: session.toolContext({ taskId, signal: context.signal, budgetGroupId: context.budgetGroupId }),
      },
    ))
    try {
      expect((await spawn('cost-a').awaitResult()).status).toBe('done')
      expect((await spawn('cost-b').awaitResult()).status).toBe('done')
      const exhausted = await spawn('cost-c').awaitResult()
      expect(exhausted.error?.code).toBe('AGGREGATE_BUDGET_EXHAUSTED')
      expect(bodies.map(body => body.max_tokens)).toEqual([2, 1])
    } finally {
      await session.shutdown()
    }
  })

  it('stops future model requests when the provider omits usage needed by the configured budget', async () => {
    const session = new OrchestratorSession({ projectRoot: process.cwd(), logFile: null, snapshotFile: null, limits: { maxAggregateTokens: 10 } })
    let requests = 0
    const client = { chat: { completions: { create: async () => {
      requests++
      return { choices: [{ message: { content: 'unmeasured response' } }] }
    } } } } as any
    const spawn = (taskId: string) => session.spawn({ taskId, budgetGroupId: 'turn', maxRetries: 0 }, context => runSubAgentLoop(
      'system', 'task', taskId, [], provider, 'fake', {
        client,
        context: session.toolContext({ taskId, signal: context.signal, budgetGroupId: context.budgetGroupId }),
      },
    ))
    try {
      const first = await spawn('unmeasured-a').awaitResult()
      const second = await spawn('unmeasured-b').awaitResult()
      expect(first.error?.code).toBe('AGGREGATE_BUDGET_UNAVAILABLE')
      expect(second.error?.code).toBe('AGGREGATE_BUDGET_UNAVAILABLE')
      expect(requests).toBe(1)
    } finally {
      await session.shutdown()
    }
  })
})
