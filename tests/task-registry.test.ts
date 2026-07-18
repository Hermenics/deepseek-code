import { describe, expect, it } from 'bun:test'
import { InvalidTaskTransitionError, TaskRegistry, TaskRuntimeError } from '../src/orchestration/index.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition timed out')
    await tick()
  }
}

describe('TaskRegistry lifecycle', () => {
  it('validates transitions and rejects double completion', async () => {
    const registry = new TaskRegistry({ sessionId: 's1', projectRoot: process.cwd() })
    const handle = registry.spawn({ taskId: 'one' }, async () => 'ok')
    expect((await handle.awaitResult()).status).toBe('done')
    expect(() => registry.transitionTask('one', 'done')).toThrow(InvalidTaskTransitionError)
    expect(() => registry.transitionTask('one', 'running')).toThrow(InvalidTaskTransitionError)
  })

  it('keeps concurrent sessions isolated', async () => {
    const first = new TaskRegistry({ sessionId: 'first', projectRoot: process.cwd() })
    const second = new TaskRegistry({ sessionId: 'second', projectRoot: process.cwd() })
    first.spawn({ taskId: 'same' }, async () => 'first')
    second.spawn({ taskId: 'same' }, async () => 'second')
    expect((await first.awaitResult('same')).value).toBe('first')
    expect((await second.awaitResult('same')).value).toBe('second')
    expect(first.getStatus('same').sessionId).not.toBe(second.getStatus('same').sessionId)
  })

  it('cancels queued and running work idempotently', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { concurrency: 1 } })
    let release!: () => void
    const first = registry.spawn({ taskId: 'running' }, ({ signal }) => new Promise<string>((resolve, reject) => {
      release = () => resolve('late')
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const queued = registry.spawn({ taskId: 'queued' }, async () => 'never')
    await waitFor(() => first.status().state === 'running')
    expect(() => registry.transitionTask(first.taskId, 'done')).toThrow(InvalidTaskTransitionError)
    expect(queued.cancel()).toBe(true)
    expect(queued.cancel()).toBe(true)
    expect((await queued.awaitResult()).status).toBe('cancelled')
    expect(first.cancel()).toBe(true)
    release()
    expect((await first.awaitResult()).status).toBe('cancelled')
  })

  it('keeps the concurrency permit until an aborted runner is actually quiescent', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { concurrency: 1 } })
    let release!: () => void
    let secondStarted = false
    const stubborn = registry.spawn({ taskId: 'stubborn' }, () => new Promise<string>(resolve => { release = () => resolve('late') }))
    const second = registry.spawn({ taskId: 'after-stubborn' }, async () => { secondStarted = true; return 'safe' })
    await waitFor(() => stubborn.status().state === 'running')
    stubborn.cancel()
    await stubborn.awaitResult()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(secondStarted).toBe(false)
    release()
    expect((await second.awaitResult()).value).toBe('safe')
  })

  it('propagates parent cancellation only for cascade tasks', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { concurrency: 3 } })
    const pending = ({ signal }: { signal: AbortSignal }) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    const parent = registry.spawn({ taskId: 'parent', allowDelegation: true }, pending)
    const cascade = registry.spawn({ taskId: 'cascade', parentTaskId: 'parent' }, pending)
    const detached = registry.spawn({ taskId: 'detached', parentTaskId: 'parent', cancellationPolicy: 'detach' }, pending)
    await waitFor(() => cascade.status().state === 'running' && detached.status().state === 'running')
    parent.cancel()
    expect((await cascade.awaitResult()).status).toBe('cancelled')
    expect(detached.status().state).toBe('running')
    detached.cancel()
  })

  it('distinguishes timeout and limits retries', async () => {
    const timeoutRegistry = new TaskRegistry({ projectRoot: process.cwd() })
    const timed = timeoutRegistry.spawn({ timeoutMs: 10, maxRetries: 0 }, () => new Promise<string>(() => {}))
    const timeoutResult = await timed.awaitResult()
    expect(timeoutResult.status).toBe('timed_out')
    expect(timeoutResult.error?.code).toBe('TIMED_OUT')

    let attempts = 0
    const retryRegistry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 1 } })
    const retried = retryRegistry.spawn({ maxRetries: 1 }, async () => {
      attempts++
      if (attempts === 1) throw new Error('transient')
      return 'recovered'
    })
    expect((await retried.awaitResult()).value).toBe('recovered')
    expect(attempts).toBe(2)
    expect(retried.status().error).toBeUndefined()
  })

  it('clears partial output between retry attempts', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    const task = registry.spawn({ maxRetries: 1 }, async context => {
      if (context.attempt === 1) {
        context.setPartial('stale partial')
        throw new TaskRuntimeError('RETRY', 'retry', true)
      }
      return 'fresh result'
    })
    const result = await task.awaitResult()
    expect(result.value).toBe('fresh result')
    expect(result.partial).toBeUndefined()
  })

  it('can cancel safely during retry backoff', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 5_000 } })
    const task = registry.spawn({ maxRetries: 1 }, async () => { throw new Error('retry me') })
    await waitFor(() => task.status().state === 'queued' && task.status().attempt === 1)
    expect(task.cancel('stop retry')).toBe(true)
    const result = await task.awaitResult()
    expect(result.status).toBe('cancelled')
    expect(result.error?.message).toBe('stop retry')
  })

  it('does not re-finalize a terminal dependent after its dependency fails', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    let fail!: () => void
    const dependency = registry.spawn({ taskId: 'dependency', maxRetries: 0 }, () => new Promise<string>((_resolve, reject) => { fail = () => reject(new Error('failed')) }))
    const dependent = registry.spawn({ taskId: 'dependent', dependencies: ['dependency'], dependencyFailurePolicy: 'fail' }, async () => 'never')
    await waitFor(() => dependency.status().state === 'running')
    dependent.cancel()
    fail()
    await dependency.awaitResult()
    await tick()
    expect(dependent.status().state).toBe('cancelled')
  })

  it('re-evaluates queued dependencies during snapshot restore', async () => {
    const seed = new TaskRegistry({ sessionId: 'restore-dag', projectRoot: process.cwd(), limits: { concurrency: 1 } })
    const dependency = seed.spawn({ taskId: 'dependency' }, ({ signal }) => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    seed.spawn({ taskId: 'dependent', dependencies: ['dependency'] }, async () => 'never')
    await waitFor(() => dependency.status().state === 'running')
    const records = seed.listTasks()
    const dependent = records.find(record => record.taskId === 'dependent')!
    dependent.state = 'queued'
    dependent.blockReason = undefined
    const restored = new TaskRegistry({ sessionId: 'restore-dag', projectRoot: process.cwd() })
    restored.restoreTasks(records, () => async () => 'restored')
    expect(restored.getStatus('dependent').state).toBe('blocked')
    expect(restored.getStatus('dependent').blockReason).toContain("Dependency 'dependency'")
    dependency.cancel()
  })

  it('rejects invalid envelopes and isolates failing event observers', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    registry.events.subscribe(() => { throw new Error('observer failure') })
    const task = registry.spawn({ maxRetries: 0 }, async context => ({
      schemaVersion: 1, taskId: context.taskId, sessionId: context.sessionId, status: 'done',
      artifacts: [], metrics: { usageAvailable: false }, completedAt: new Date().toISOString(), extra: true,
    }) as never)
    const result = await task.awaitResult()
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('INVALID_RESULT')
  })

  it('schedules a DAG and detects cycles', async () => {
    const order: string[] = []
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const first = registry.spawn({ taskId: 'first' }, async () => { order.push('first'); return 1 })
    const second = registry.spawn({ taskId: 'second', dependencies: ['first'] }, async () => { order.push('second'); return 2 })
    expect(second.status().state).toBe('blocked')
    await first.awaitResult()
    await second.awaitResult()
    expect(order).toEqual(['first', 'second'])

    const third = registry.spawn({ taskId: 'third' }, async () => 3)
    registry.addDependency('third', 'second')
    expect(() => registry.addDependency('first', 'third')).toThrow('cycle')
    await third.awaitResult()
  })

  it('supports explicit block and resume', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const task = registry.spawn({ taskId: 'blocked', maxRetries: 1 }, async ({ attempt, signal }) => {
      if (attempt === 1) return new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return 'resumed'
    })
    await waitFor(() => task.status().state === 'running')
    expect(registry.block(task.taskId, 'needs input')).toBe(true)
    expect(task.status().state).toBe('blocked')
    expect(task.resume()).toBe(true)
    expect((await task.awaitResult()).value).toBe('resumed')
  })

  it('enforces concurrency, depth, fan-out and task limits', async () => {
    let running = 0
    let peak = 0
    let releaseAll!: () => void
    const gate = new Promise<void>(resolve => { releaseAll = resolve })
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { concurrency: 2, maxTasks: 5, maxDepth: 1, maxFanOut: 1 } })
    const runner = async () => {
      running++; peak = Math.max(peak, running)
      await gate
      running--
      return 'done'
    }
    const parent = registry.spawn({ taskId: 'parent', allowDelegation: true }, runner)
    const child = registry.spawn({ taskId: 'child', parentTaskId: 'parent' }, runner)
    expect(() => registry.spawn({ taskId: 'fanout', parentTaskId: 'parent' }, runner)).toThrow('fan-out')
    expect(() => registry.spawn({ taskId: 'deep', parentTaskId: 'child' }, runner)).toThrow('depth')
    const other = registry.spawn({ taskId: 'other' }, runner)
    await waitFor(() => running === 2)
    expect(peak).toBe(2)
    releaseAll()
    await Promise.all([parent.awaitResult(), child.awaitResult(), other.awaitResult()])
  })

  it('enforces per-task delegation and known usage budgets', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const parent = registry.spawn({ taskId: 'bounded-parent', allowDelegation: false }, async () => 'parent')
    expect(() => registry.spawn({ parentTaskId: parent.taskId }, async () => 'child')).toThrow('cannot delegate')
    await parent.awaitResult()

    const budgeted = registry.spawn({ taskId: 'budgeted', maxTokens: 10, maxRetries: 0 }, async context => {
      context.setPartial('work was produced')
      registry.updateMetrics(context.taskId, { tokens: 11, usageAvailable: true })
      return 'too expensive'
    })
    const result = await budgeted.awaitResult()
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('TOKEN_BUDGET_EXCEEDED')
    expect(result.partial).toBe('work was produced')

    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
      expect(() => registry.spawn({ maxTokens: invalid }, async () => 'never')).toThrow('Invalid token budget')
    }

    const supplied = registry.spawn({ taskId: 'supplied-budget', maxTokens: 5, maxRetries: 0 }, async context => ({
      schemaVersion: 1 as const, taskId: context.taskId, sessionId: context.sessionId, status: 'done' as const,
      value: 'over', artifacts: [], metrics: { tokens: 6, usageAvailable: true }, completedAt: new Date().toISOString(),
    }))
    expect((await supplied.awaitResult()).error?.code).toBe('TOKEN_BUDGET_EXCEEDED')
    expect(supplied.status().metrics.tokens).toBe(6)
  })

  it('deduplicates mailbox messages', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const task = registry.spawn({ taskId: 'mail' }, async () => 'ok')
    const first = task.sendMessage('progress', { percent: 10 }, undefined, 'same-message')
    const duplicate = task.sendMessage('progress', { percent: 10 }, undefined, 'same-message')
    expect(duplicate.payload).toEqual(first.payload)
    expect(() => task.sendMessage('progress', { percent: 90 }, undefined, 'same-message')).toThrow('collision')
    expect(registry.mailbox.list().length).toBe(1)
    await task.awaitResult()
  })

  it('lets a runner receive and acknowledge coordinator messages', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const task = registry.spawn({ taskId: 'receiver' }, async context => {
      await tick()
      const [message] = context.receiveMessages('pending')
      expect(context.acknowledgeMessage(message!.messageId)).toBe(true)
      return message!.payload.answer
    })
    task.sendMessage('question', { answer: 42 })
    expect((await task.awaitResult()).value).toBe(42)
    expect(registry.mailbox.list('receiver', 'processed')).toHaveLength(1)
  })
})
