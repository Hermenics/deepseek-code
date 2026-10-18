import { describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { AGGREGATE_REQUEST_BYTES, InvalidTaskTransitionError, TaskRegistry, TaskRuntimeError } from '../src/orchestration/index.js'
import { assertProviderRequestBudget } from '../src/agent/toolOutputBudget.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition timed out')
    await tick()
  }
}

describe('TaskRegistry lifecycle', () => {
  it('shares the default request-byte allowance by group and charges only successful reservations', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const first = await registry.acquireAggregateBudget('turn')
    if (!first) throw new Error('Expected an aggregate budget lease without token or cost limits')
    expect(AGGREGATE_REQUEST_BYTES).toBe(16 * 1024 * 1024)
    expect(first.reserveRequestBytes(AGGREGATE_REQUEST_BYTES - 1)).toBe(1)
    first.release()

    const sameGroup = await registry.acquireAggregateBudget('turn')
    if (!sameGroup) throw new Error('Expected a shared aggregate budget lease')
    expect(() => sameGroup.reserveRequestBytes(2)).toThrow('16 MiB')
    sameGroup.release()

    const remainder = await registry.acquireAggregateBudget('turn')
    if (!remainder) throw new Error('Expected the shared aggregate budget lease')
    expect(remainder.reserveRequestBytes(1)).toBe(0)
    remainder.release()

    const exactBoundary = await registry.acquireAggregateBudget('exact-boundary')
    if (!exactBoundary) throw new Error('Expected an independent aggregate budget lease')
    expect(exactBoundary.reserveRequestBytes(AGGREGATE_REQUEST_BYTES)).toBe(0)
    exactBoundary.release()

    const otherGroup = await registry.acquireAggregateBudget('other')
    if (!otherGroup) throw new Error('Expected an independent aggregate budget lease')
    expect(otherGroup.reserveRequestBytes(1)).toBe(AGGREGATE_REQUEST_BYTES - 1)
    otherGroup.release()
  })

  it('fails closed on unavailable request sizes without charging the group', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const lease = await registry.acquireAggregateBudget('turn')
    if (!lease) throw new Error('Expected an aggregate budget lease')
    for (const invalidSize of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => lease.reserveRequestBytes(invalidSize)).toThrow('valid serialized request size')
    }
    expect(lease.reserveRequestBytes(AGGREGATE_REQUEST_BYTES)).toBe(0)
    lease.release()
  })

  it('charges the exact UTF-8 byte count returned for a complete provider body', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const request = { model: 'fake', messages: [{ role: 'user', content: 'café 🙂' }] }
    const requestBytes = assertProviderRequestBudget(request)
    expect(requestBytes).toBe(Buffer.byteLength(JSON.stringify(request), 'utf8'))
    expect(requestBytes).toBeGreaterThan(JSON.stringify(request).length)

    const lease = await registry.acquireAggregateBudget('utf8')
    if (!lease) throw new Error('Expected an aggregate budget lease')
    expect(lease.reserveRequestBytes(requestBytes)).toBe(AGGREGATE_REQUEST_BYTES - requestBytes)
    lease.release()
  })

  it('does not charge an acquired request cancelled before dispatch', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const undispatched = await registry.acquireAggregateBudget('undispatched')
    if (!undispatched) throw new Error('Expected an aggregate budget lease')
    undispatched.release()
    const next = await registry.acquireAggregateBudget('undispatched')
    if (!next) throw new Error('Expected an aggregate budget lease')
    expect(next.reserveRequestBytes(AGGREGATE_REQUEST_BYTES)).toBe(0)
    next.release()

    const active = await registry.acquireAggregateBudget('cancelled')
    if (!active) throw new Error('Expected an aggregate budget lease')
    const controller = new AbortController()
    const cancelled = registry.acquireAggregateBudget('cancelled', controller.signal)
    controller.abort(new Error('cancelled before dispatch'))
    await expect(cancelled).rejects.toThrow('cancelled before dispatch')
    active.release()
    const afterCancel = await registry.acquireAggregateBudget('cancelled')
    if (!afterCancel) throw new Error('Expected an aggregate budget lease')
    expect(afterCancel.reserveRequestBytes(AGGREGATE_REQUEST_BYTES)).toBe(0)
    afterCancel.release()
  })

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

  it('attaches partial output and artifacts observed after cancellation', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const handle = registry.spawn({ taskId: 'late-output', maxRetries: 0 }, async context => {
      await waiting
      context.setPartial({ state: 'cancelled', outputId: 'output-1' })
      context.recordArtifact({ id: 'output-1', kind: 'log', metadata: { source: 'shell' } })
      throw new Error('process stopped after cancellation')
    })

    await waitFor(() => handle.status().state === 'running')
    expect(handle.cancel()).toBe(true)
    expect((await handle.awaitResult()).partial).toBeUndefined()
    release()
    await registry.awaitIdle()

    expect(handle.getResult()).toMatchObject({
      status: 'cancelled',
      partial: { state: 'cancelled', outputId: 'output-1' },
      artifacts: [{ id: 'output-1', kind: 'log', metadata: { source: 'shell' } }],
    })
    expect(handle.status().artifactRefs).toContain('output-1')
  })

  it('restores partial effects and artifact metadata from an interrupted task record', async () => {
    const registry = new TaskRegistry({ sessionId: 'recover-partial', projectRoot: process.cwd() })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const handle = registry.spawn({ taskId: 'in-progress' }, async context => {
      context.setPartial({ state: 'running', outputId: 'output-2' })
      context.recordArtifact({ id: 'output-2', kind: 'log', metadata: { source: 'shell' } })
      await waiting
      return 'finished'
    })
    await waitFor(() => handle.status().artifacts?.length === 1)

    const restored = new TaskRegistry({ sessionId: 'recover-partial', projectRoot: process.cwd() })
    restored.restoreTasks([handle.status()])
    expect(restored.getResult('in-progress')).toMatchObject({
      status: 'failed',
      partial: { state: 'running', outputId: 'output-2' },
      artifacts: [{ id: 'output-2', kind: 'log', metadata: { source: 'shell' } }],
    })
    expect(restored.getStatus('in-progress').artifactRefs).toContain('output-2')

    handle.cancel()
    release()
    await registry.awaitIdle()
  })

  it('tracks sequential child processes after each previous process exits', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const task = registry.spawn({ taskId: 'sequential-processes', maxRetries: 0 }, async context => {
      const first = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
      context.trackProcess(first)
      await new Promise<void>(resolve => first.once('exit', () => resolve()))
      const second = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
      context.trackProcess(second)
      await new Promise<void>(resolve => second.once('exit', () => resolve()))
      return 'done'
    })

    expect((await task.awaitResult()).status).toBe('done')
    expect(task.status().process?.status).toBe('exited')
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
    const retried = retryRegistry.spawn({ maxRetries: 1, effectPolicy: 'tool-gated' }, async () => {
      attempts++
      if (attempts === 1) throw new TaskRuntimeError('TRANSIENT', 'transient', true)
      return 'recovered'
    })
    expect((await retried.awaitResult()).value).toBe('recovered')
    expect(attempts).toBe(2)
    expect(retried.status().error).toBeUndefined()
  })

  it('does not automatically retry after a task reports a possible external effect', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    let attempts = 0
    const task = registry.spawn({ maxRetries: 2, effectPolicy: 'tool-gated' }, async context => {
      attempts++
      await context.markEffectStarted('write_file')
      throw new TaskRuntimeError('TRANSIENT', 'connection lost after write', true)
    })

    const result = await task.awaitResult()

    expect(result.status).toBe('failed')
    expect(result.error?.retryable).toBe(false)
    expect(result.error?.message).toContain('automatic retry stopped after a possible external effect')
    expect(task.status().effectMayHaveStarted).toBe(true)
    expect(() => task.resume()).toThrow('may have started external effects')
    expect(attempts).toBe(1)
  })

  it('requires a durable user reconciliation for the exact stopped attempt before resume', async () => {
    let registry!: TaskRegistry
    let snapshot: ReturnType<TaskRegistry['listTasks']> = []
    let attempts = 0
    registry = new TaskRegistry({
      projectRoot: process.cwd(), limits: { retryBackoffMs: 0 },
      persistReconciliation: async () => { snapshot = registry.listTasks() },
    })
    const task = registry.spawn({ taskId: 'reconcile-me', maxRetries: 1, effectPolicy: 'tool-gated' }, async context => {
      attempts++
      await context.markEffectStarted('write_file')
      throw new TaskRuntimeError('OUTCOME_UNKNOWN', 'write outcome was lost')
    })

    await task.awaitResult()
    await registry.awaitIdle()
    expect(() => task.resume()).toThrow('reconcile effects')
    await expect(registry.reconcileEffects(task.taskId, 'no-effect', 'I inspected the target and confirmed the write did not happen.')).resolves.toMatchObject({ resolution: 'no-effect' })
    expect(snapshot.find(record => record.taskId === task.taskId)?.effectReconciliations).toMatchObject([
      { attempt: 1, resolution: 'no-effect', actor: 'user' },
    ])

    expect(task.resume()).toBe(true)
    await task.awaitResult()
    await registry.awaitIdle()
    expect(attempts).toBe(2)
    expect(task.status().effectMayHaveStarted).toBe(true)
    expect(() => task.resume()).toThrow('reconcile effects')
    expect(task.status().effectReconciliations).toHaveLength(1)
  })

  it('does not let an interrupted attempt without process identity resume after a no-effect claim', async () => {
    const sessionId = 'interrupted-without-process-identity'
    const source = new TaskRegistry({ sessionId, projectRoot: process.cwd() })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    let attempts = 0
    const original = source.spawn({ taskId: 'missing-process-identity', effectPolicy: 'tool-gated', maxRetries: 1 }, async context => {
      attempts++
      await context.markEffectStarted('shell')
      await waiting
      return 'late result'
    })
    await waitFor(() => original.status().state === 'running' && original.status().effectMayHaveStarted === true)

    let restored!: TaskRegistry
    restored = new TaskRegistry({
      sessionId, projectRoot: process.cwd(),
      persistReconciliation: async () => { restored.listTasks() },
    })
    restored.restoreTasks([original.status()], () => async () => { attempts++; return 'unsafe replay' })
    expect(restored.getStatus(original.taskId)).toMatchObject({ state: 'failed', error: { code: 'INTERRUPTED' } })
    expect(restored.getStatus(original.taskId).process).toBeUndefined()

    await expect(restored.reconcileEffects(original.taskId, 'no-effect', 'I inspected the workspace and confirmed no effect occurred.'))
      .rejects.toMatchObject({ code: 'PROCESS_STATE_UNVERIFIED' })
    expect(() => restored.resume(original.taskId)).toThrow('process identity')

    const legacyReview = restored.getStatus(original.taskId)
    legacyReview.effectReconciliations = [{
      attempt: legacyReview.attempt,
      resolution: 'no-effect',
      evidence: 'A previous version recorded a user review.',
      actor: 'user',
      reconciledAt: new Date().toISOString(),
    }]
    const restarted = new TaskRegistry({ sessionId, projectRoot: process.cwd() })
    restarted.restoreTasks([legacyReview], () => async () => { attempts++; return 'unsafe legacy replay' })
    expect(() => restarted.resume(original.taskId)).toThrow('process identity')
    expect(attempts).toBe(1)

    original.cancel()
    release()
    await source.awaitIdle()
    await restored.awaitIdle()
    await restarted.awaitIdle()
  })

  it('resumes after every current-attempt tool effect is durably verified as absent', async () => {
    let registry!: TaskRegistry
    let durable: ReturnType<TaskRegistry['listTasks']> = []
    let attempts = 0
    registry = new TaskRegistry({
      sessionId: 'automatic-effect-review', projectRoot: process.cwd(), limits: { retryBackoffMs: 0 },
      persistEffectMarker: async () => { durable = registry.listTasks() },
    })
    const task = registry.spawn({ taskId: 'verified-no-effect', maxRetries: 1, effectPolicy: 'tool-gated' }, async context => {
      attempts++
      if (attempts === 1) {
        const effectId = await context.markEffectStarted('git')
        await context.markEffectOutcome(effectId, 'no-effect', `git-local-state-unchanged:${'a'.repeat(64)}`)
        throw new TaskRuntimeError('GIT_LOCAL_EFFECT_NOT_APPLIED', 'Git state was unchanged')
      }
      return 'recovered'
    })

    expect((await task.awaitResult()).status).toBe('failed')
    await registry.awaitIdle()
    expect(task.status().effectMayHaveStarted).toBe(false)
    expect(task.status().effectLedger).toMatchObject([
      { attempt: 1, tool: 'git', state: 'no-effect', evidence: `git-local-state-unchanged:${'a'.repeat(64)}` },
    ])
    expect(durable.find(record => record.taskId === task.taskId)?.effectLedger?.[0]?.state).toBe('no-effect')

    expect(task.resume()).toBe(true)
    expect((await task.awaitResult()).value).toBe('recovered')
    expect(attempts).toBe(2)
  })

  it('aggregates only durable exact positive effects across nested tasks', async () => {
    let registry!: TaskRegistry
    let durable: ReturnType<TaskRegistry['listTasks']> = []
    registry = new TaskRegistry({
      sessionId: 'descendant-effects', projectRoot: process.cwd(),
      persistEffectMarker: async () => { durable = registry.listTasks() },
    })
    const root = registry.spawn({ taskId: 'effect-root', effectPolicy: 'tool-gated', allowDelegation: true }, async context => {
      const child = registry.spawn({
        taskId: 'effect-child', parentTaskId: context.taskId, effectPolicy: 'tool-gated', allowDelegation: true,
      }, async childContext => {
        const grandchild = registry.spawn({
          taskId: 'effect-grandchild', parentTaskId: childContext.taskId, effectPolicy: 'tool-gated',
        }, async grandchildContext => {
          const observed = await grandchildContext.markEffectStarted('git')
          await grandchildContext.markEffectOutcome(observed, 'effect-observed', `git-commit:${'a'.repeat(64)}`)
          const unknown = await grandchildContext.markEffectStarted('mcp')
          expect(unknown).toBeTruthy()
          return 'completed'
        })
        await grandchild.awaitResult()
        return 'completed'
      })
      await child.awaitResult()
      return 'completed'
    })

    await root.awaitResult()
    const aggregate = registry.getObservedEffectAggregate(root.taskId)
    expect(aggregate).toMatchObject({
      taskId: root.taskId,
      coverage: 'durable-positive-outcomes-only',
      durable: true,
      allRecordedEffectsSettled: false,
      unresolvedAttempts: 1,
      observedEffects: [{ taskId: 'effect-grandchild', attempt: 1, tool: 'git' }],
    })
    expect(aggregate.observedEffects[0]?.evidenceSha256).toBe(createHash('sha256').update(`git-commit:${'a'.repeat(64)}`).digest('hex'))
    expect(aggregate).not.toHaveProperty('state', 'no-effect')
    expect(durable.find(record => record.taskId === 'effect-grandchild')?.effectLedger).toMatchObject([
      { state: 'effect-observed', evidence: `git-commit:${'a'.repeat(64)}` },
      { state: 'unknown', tool: 'mcp' },
    ])
  })

  it('does not treat empty ledgers or non-durable receipts as no-effect', async () => {
    const memoryOnly = new TaskRegistry({ sessionId: 'memory-only-effects', projectRoot: process.cwd() })
    const memoryTask = memoryOnly.spawn({ taskId: 'memory-effects', effectPolicy: 'tool-gated' }, async context => {
      const effect = await context.markEffectStarted('git')
      await context.markEffectOutcome(effect, 'effect-observed', `git-commit:${'b'.repeat(64)}`)
      return 'completed'
    })
    await memoryTask.awaitResult()
    expect(memoryOnly.getObservedEffectAggregate(memoryTask.taskId)).toMatchObject({
      durable: false, observedEffects: [], unresolvedAttempts: 1, coverage: 'durable-positive-outcomes-only',
    })

    const durable = new TaskRegistry({
      sessionId: 'empty-effects', projectRoot: process.cwd(), persistEffectMarker: async () => {},
    })
    const empty = durable.spawn({ taskId: 'empty-ledger', effectPolicy: 'tool-gated' }, async () => 'completed')
    await empty.awaitResult()
    expect(durable.getObservedEffectAggregate(empty.taskId)).toMatchObject({
      durable: true, allRecordedEffectsSettled: true, observedEffects: [], unresolvedAttempts: 0,
    })
    expect(durable.getObservedEffectAggregate(empty.taskId)).not.toHaveProperty('state')
  })

  it('keeps malformed persisted no-effect receipts unresolved in descendant coverage', async () => {
    const sessionId = 'malformed-no-effect-aggregate'
    const registry = new TaskRegistry({
      sessionId,
      projectRoot: process.cwd(),
      persistEffectMarker: async () => {},
    })
    const task = registry.spawn({ taskId: 'malformed-no-effect-task', effectPolicy: 'tool-gated' }, async context => {
      const effectId = await context.markEffectStarted('git')
      await context.markEffectOutcome(effectId, 'no-effect', `git-state-unchanged:${'f'.repeat(64)}`)
      return 'completed'
    })
    await task.awaitResult()

    const snapshot = registry.listTasks()
    delete snapshot[0]!.effectLedger![0]!.resolvedAt
    const restored = new TaskRegistry({ sessionId, projectRoot: process.cwd(), persistEffectMarker: async () => {} })
    restored.restoreTasks(snapshot, () => async () => 'completed')

    expect(restored.getObservedEffectAggregate(task.taskId)).toMatchObject({
      allRecordedEffectsSettled: false,
      unresolvedAttempts: 1,
    })
  })

  it('binds a child outcome aggregate to the exact parent effect attempt', async () => {
    let registry!: TaskRegistry
    let durable: ReturnType<TaskRegistry['listTasks']> = []
    registry = new TaskRegistry({
      sessionId: 'linked-parent-effect', projectRoot: process.cwd(),
      persistEffectMarker: async () => { durable = registry.listTasks() },
    })
    const parent = registry.spawn({ taskId: 'linked-parent', effectPolicy: 'tool-gated', allowDelegation: true }, async context => {
      const parentEffectId = await context.markEffectStarted('subagent')
      expect(() => registry.spawn({ parentTaskId: context.taskId, parentEffectId: 'missing-effect' }, async () => 'never'))
        .toThrow('unresolved effect in the current attempt')
      const child = registry.spawn({
        taskId: 'linked-child', parentTaskId: context.taskId, parentEffectId, effectPolicy: 'tool-gated',
      }, async childContext => {
        const childEffectId = await childContext.markEffectStarted('write_file')
        await childContext.markEffectOutcome(childEffectId, 'effect-observed', `file-write:${'c'.repeat(64)}`)
        return 'completed'
      })
      await child.awaitResult()

      const aggregate = registry.getObservedEffectAggregate(child.taskId, parentEffectId)
      expect(aggregate.parentEffectIdMatches).toBe(true)
    expect(aggregate.allRecordedEffectsSettled).toBe(true)
      expect(aggregate.positiveEvidence).toMatch(/^descendant-effects-sha256:[a-f0-9]{64}$/)
      await context.markEffectOutcome(parentEffectId, 'effect-observed', aggregate.positiveEvidence!)
      return 'completed'
    })

    expect((await parent.awaitResult()).status).toBe('done')
    expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'effect-observed' }])
    expect(durable.find(record => record.taskId === 'linked-child')).toMatchObject({
      parentTaskId: parent.taskId, parentEffectId: parent.status().effectLedger?.[0]?.id, parentEffectAttempt: 1,
    })
    const mismatched = registry.getObservedEffectAggregate('linked-child', 'wrong-effect')
    expect(mismatched.parentEffectIdMatches).toBe(false)
    expect(mismatched.allRecordedEffectsSettled).toBe(false)
    expect(mismatched).not.toHaveProperty('positiveEvidence')

    const restored = new TaskRegistry({
      sessionId: 'linked-parent-effect', projectRoot: process.cwd(), persistEffectMarker: async () => {},
    })
    restored.restoreTasks(durable, record => async () => record.result?.value)
    const restoredAggregate = restored.getObservedEffectAggregate('linked-child', parent.status().effectLedger?.[0]?.id)
    expect(restoredAggregate).toMatchObject({
      parentEffectIdMatches: true, observedEffects: [{ taskId: 'linked-child', tool: 'write_file' }],
    })
    await restored.awaitIdle()
  })

  it('records a linked child positive receipt after its parent has completed', async () => {
    let releaseChild!: () => void
    const childGate = new Promise<void>(resolve => { releaseChild = resolve })
    let registry!: TaskRegistry
    let durable: ReturnType<TaskRegistry['listTasks']> = []
    let persistedParentEffectOnEvent: string | undefined
    registry = new TaskRegistry({
      sessionId: 'late-linked-child-effect', projectRoot: process.cwd(),
      persistEffectMarker: async () => { durable = registry.listTasks() },
    })
    registry.events.subscribe(event => {
      if (event.type !== 'effect_outcome' || event.taskId !== 'late-effect-parent') return
      persistedParentEffectOnEvent = durable.find(record => record.taskId === 'late-effect-parent')?.effectLedger?.[0]?.state
    })
    const parent = registry.spawn({ taskId: 'late-effect-parent', effectPolicy: 'tool-gated', allowDelegation: true }, async context => {
      const parentEffectId = await context.markEffectStarted('subagent')
      registry.spawn({ taskId: 'late-effect-child', parentTaskId: context.taskId, parentEffectId, effectPolicy: 'tool-gated' }, async childContext => {
        const effectId = await childContext.markEffectStarted('write_file')
        await childGate
        await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'a'.repeat(64)}`)
        return 'child finished'
      })
      return 'parent finished first'
    })

    try {
      await parent.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(parent.taskId).inFlight)
      expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])

      releaseChild()
      await registry.awaitResult('late-effect-child')
      await registry.awaitIdle()

      expect(parent.status().effectLedger).toMatchObject([{
        tool: 'subagent', state: 'effect-observed', evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
      }])
      expect(persistedParentEffectOnEvent).toBe('effect-observed')
      expect(registry.events.list(parent.taskId).filter(event => event.type === 'effect_outcome')).toHaveLength(1)
    } finally {
      releaseChild()
      await registry.awaitIdle()
    }
  })

  it('waits for a closed subtree and its receipt propagation without waiting for unrelated tasks', async () => {
    let releaseUnrelated!: () => void
    const unrelatedGate = new Promise<void>(resolve => { releaseUnrelated = resolve })
    const registry = new TaskRegistry({
      sessionId: 'scoped-subtree-settling', projectRoot: process.cwd(), limits: { concurrency: 3 },
      persistEffectMarker: async () => {},
    })
    const parent = registry.spawn({
      taskId: 'scoped-effect-parent', effectPolicy: 'tool-gated', allowDelegation: true,
    }, async context => {
      const parentEffectId = await context.markEffectStarted('subagent')
      registry.spawn({
        taskId: 'scoped-effect-child', parentTaskId: context.taskId, parentEffectId,
        effectPolicy: 'tool-gated',
      }, async childContext => {
        const effectId = await childContext.markEffectStarted('write_file')
        await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'a'.repeat(64)}`)
        return 'child done'
      })
      return 'parent done'
    })
    const unrelated = registry.spawn({ taskId: 'unrelated-running-task', effectPolicy: 'tool-gated' }, async () => {
      await unrelatedGate
      return 'unrelated done'
    })

    try {
      await parent.awaitResult()
      await registry.awaitResult('scoped-effect-child')
      await waitFor(() => registry.getStatus('scoped-effect-parent').state === 'done'
        && registry.getStatus('scoped-effect-child').state === 'done'
        && unrelated.status().state === 'running')

      const childSlot = (registry as any).tasks.get('scoped-effect-child')
      childSlot.inFlight = true
      let settled = false
      const barrier = registry.awaitSubtreeSettled(parent.taskId).then(() => { settled = true })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(settled).toBe(false)

      childSlot.inFlight = false
      await barrier
      expect(unrelated.status().state).toBe('running')
      expect(parent.status().effectLedger).toMatchObject([{
        tool: 'subagent', state: 'effect-observed',
        evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
      }])
    } finally {
      releaseUnrelated()
      await registry.awaitIdle()
    }
  })

  it('propagates a positive receipt when a blocked linked sibling is cancelled', async () => {
    let releaseBlocker!: () => void
    const blockerGate = new Promise<void>(resolve => { releaseBlocker = resolve })
    const registry = new TaskRegistry({
      sessionId: 'late-effect-cancelled-linked-child', projectRoot: process.cwd(),
      limits: { concurrency: 3 }, persistEffectMarker: async () => {},
    })
    const blocker = registry.spawn({ taskId: 'late-effect-dependency-blocker' }, async () => {
      await blockerGate
      return 'released'
    })

    try {
      await waitFor(() => blocker.status().state === 'running')
      const parent = registry.spawn({
        taskId: 'cancelled-linked-child-parent', effectPolicy: 'tool-gated', allowDelegation: true,
      }, async context => {
        const parentEffectId = await context.markEffectStarted('subagent')
        const positiveChild = registry.spawn({
          taskId: 'cancelled-linked-child-positive', parentTaskId: context.taskId,
          parentEffectId, effectPolicy: 'tool-gated',
        }, async childContext => {
          const effectId = await childContext.markEffectStarted('write_file')
          await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'f'.repeat(64)}`)
          return 'positive child finished'
        })
        registry.spawn({
          taskId: 'cancelled-linked-child-blocked', parentTaskId: context.taskId,
          parentEffectId, dependencies: [blocker.taskId], effectPolicy: 'tool-gated',
        }, async () => 'must stay blocked')
        await positiveChild.awaitResult()
        return 'parent finished'
      })

      await parent.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(parent.taskId).inFlight
        && registry.getStatus('cancelled-linked-child-blocked').state === 'blocked'
        && (registry as any).effectPropagationPending === 0)
      expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])

      expect(registry.cancel('cancelled-linked-child-blocked')).toBe(true)
      await registry.awaitResult('cancelled-linked-child-blocked')
      await waitFor(() => (registry as any).effectPropagationPending === 0)

      expect(registry.getStatus('cancelled-linked-child-blocked').state).toBe('cancelled')
      expect(parent.status().effectLedger).toMatchObject([{
        tool: 'subagent', state: 'effect-observed',
        evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
      }])
    } finally {
      releaseBlocker()
      await registry.awaitIdle()
    }
  })

  it('propagates a positive receipt when a linked child fails on its dependency', async () => {
    let failBlocker!: () => void
    const blockerGate = new Promise<void>(resolve => { failBlocker = resolve })
    const registry = new TaskRegistry({
      sessionId: 'late-effect-failed-linked-child', projectRoot: process.cwd(),
      limits: { concurrency: 3 }, persistEffectMarker: async () => {},
    })
    const blocker = registry.spawn({ taskId: 'late-effect-failure-dependency' }, async () => {
      await blockerGate
      throw new Error('dependency failed')
    })

    try {
      await waitFor(() => blocker.status().state === 'running')
      const parent = registry.spawn({
        taskId: 'failed-linked-child-parent', effectPolicy: 'tool-gated', allowDelegation: true,
      }, async context => {
        const parentEffectId = await context.markEffectStarted('subagent')
        const positiveChild = registry.spawn({
          taskId: 'failed-linked-child-positive', parentTaskId: context.taskId,
          parentEffectId, effectPolicy: 'tool-gated',
        }, async childContext => {
          const effectId = await childContext.markEffectStarted('write_file')
          await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'a'.repeat(64)}`)
          return 'positive child finished'
        })
        registry.spawn({
          taskId: 'failed-linked-child-blocked', parentTaskId: context.taskId,
          parentEffectId, dependencies: [blocker.taskId], dependencyFailurePolicy: 'fail', effectPolicy: 'tool-gated',
        }, async () => 'must stay blocked')
        await positiveChild.awaitResult()
        return 'parent finished'
      })

      await parent.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(parent.taskId).inFlight
        && registry.getStatus('failed-linked-child-blocked').state === 'blocked'
        && (registry as any).effectPropagationPending === 0)
      expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])

      failBlocker()
      await registry.awaitResult('failed-linked-child-blocked')
      await waitFor(() => (registry as any).effectPropagationPending === 0)

      expect(registry.getStatus('failed-linked-child-blocked').state).toBe('failed')
      expect(parent.status().effectLedger).toMatchObject([{
        tool: 'subagent', state: 'effect-observed',
        evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
      }])
    } finally {
      failBlocker()
      await registry.awaitIdle()
    }
  })

  it('propagates late positive receipts through nested detached descendants', async () => {
    let releaseGrandchild!: () => void
    const grandchildGate = new Promise<void>(resolve => { releaseGrandchild = resolve })
    let registry!: TaskRegistry
    registry = new TaskRegistry({
      sessionId: 'late-nested-child-effects', projectRoot: process.cwd(),
      persistEffectMarker: async () => { registry.listTasks() },
    })
    const root = registry.spawn({ taskId: 'late-nested-root', effectPolicy: 'tool-gated', allowDelegation: true }, async rootContext => {
      const rootEffectId = await rootContext.markEffectStarted('subagent')
      const child = registry.spawn({
        taskId: 'late-nested-child', parentTaskId: rootContext.taskId, parentEffectId: rootEffectId,
        effectPolicy: 'tool-gated', allowDelegation: true,
      }, async childContext => {
        const childEffectId = await childContext.markEffectStarted('subagent')
        registry.spawn({
          taskId: 'late-nested-grandchild', parentTaskId: childContext.taskId, parentEffectId: childEffectId,
          effectPolicy: 'tool-gated',
        }, async grandchildContext => {
          const effectId = await grandchildContext.markEffectStarted('write_file')
          await grandchildGate
          await grandchildContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'b'.repeat(64)}`)
          return 'grandchild finished'
        })
        return 'child detached its grandchild'
      })
      await child.awaitResult()
      return 'root detached its descendants'
    })

    try {
      await root.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(root.taskId).inFlight
        && !(registry as any).tasks.get('late-nested-child').inFlight)
      expect(root.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])
      expect(registry.getStatus('late-nested-child').effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])

      releaseGrandchild()
      await registry.awaitResult('late-nested-grandchild')
      await registry.awaitIdle()

      expect(registry.getStatus('late-nested-child').effectLedger).toMatchObject([{
        tool: 'subagent', state: 'effect-observed', evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
      }])
      expect(root.status().effectLedger).toMatchObject([{
        tool: 'subagent', state: 'effect-observed', evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
      }])
    } finally {
      releaseGrandchild()
      await registry.awaitIdle()
    }
  })

  it('does not propagate stale links or effects linked to another parent tool', async () => {
    const gates = new Map<string, () => void>()
    const waiting = new Map<string, Promise<void>>()
    for (const id of ['stale-link-child', 'wrong-tool-child']) {
      waiting.set(id, new Promise<void>(resolve => { gates.set(id, resolve) }))
    }
    const registry = new TaskRegistry({
      sessionId: 'late-effect-invalid-links', projectRoot: process.cwd(),
      persistEffectMarker: async () => {},
    })
    const parent = registry.spawn({ taskId: 'invalid-link-parent', effectPolicy: 'tool-gated', allowDelegation: true }, async context => {
      const subagentEffectId = await context.markEffectStarted('subagent')
      const gitEffectId = await context.markEffectStarted('git')
      for (const [taskId, parentEffectId] of [['stale-link-child', subagentEffectId], ['wrong-tool-child', gitEffectId]]) {
        registry.spawn({ taskId, parentTaskId: context.taskId, parentEffectId, effectPolicy: 'tool-gated' }, async childContext => {
          const effectId = await childContext.markEffectStarted('write_file')
          await waiting.get(taskId)!
          await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'c'.repeat(64)}`)
          return 'child finished'
        })
      }
      return 'parent finished first'
    })

    try {
      await parent.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(parent.taskId).inFlight
        && ['stale-link-child', 'wrong-tool-child'].every(id => (registry as any).tasks.get(id).inFlight))
      ;(registry as any).tasks.get('stale-link-child').record.parentEffectAttempt = 2
      gates.get('stale-link-child')!()
      gates.get('wrong-tool-child')!()
      await registry.awaitIdle()

      expect(parent.status().effectLedger).toMatchObject([
        { tool: 'subagent', state: 'unknown' },
        { tool: 'git', state: 'unknown' },
      ])
    } finally {
      for (const release of gates.values()) release()
      await registry.awaitIdle()
    }
  })

  it('rolls back a late parent receipt when persistence fails', async () => {
    let releaseChild!: () => void
    const childGate = new Promise<void>(resolve => { releaseChild = resolve })
    let registry!: TaskRegistry
    registry = new TaskRegistry({
      sessionId: 'late-effect-persist-failure', projectRoot: process.cwd(),
      persistEffectMarker: async () => {
        if (registry.getStatus('persist-failure-parent').effectLedger?.some(effect => effect.tool === 'subagent' && effect.state === 'effect-observed')) {
          throw new Error('snapshot unavailable')
        }
      },
    })
    const parent = registry.spawn({ taskId: 'persist-failure-parent', effectPolicy: 'tool-gated', allowDelegation: true }, async context => {
      const parentEffectId = await context.markEffectStarted('subagent')
      registry.spawn({ taskId: 'persist-failure-child', parentTaskId: context.taskId, parentEffectId, effectPolicy: 'tool-gated' }, async childContext => {
        const effectId = await childContext.markEffectStarted('write_file')
        await childGate
        await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'d'.repeat(64)}`)
        return 'child finished'
      })
      return 'parent finished first'
    })

    try {
      await parent.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(parent.taskId).inFlight)
      releaseChild()
      await registry.awaitResult('persist-failure-child')
      await registry.awaitIdle()

      expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])
      expect(registry.events.list(parent.taskId).filter(event => event.type === 'effect_outcome')).toHaveLength(0)
    } finally {
      releaseChild()
      await registry.awaitIdle()
    }
  })

  it('re-evaluates a failed child positive receipt after restore without trusting its saved runner policy', async () => {
    let registry!: TaskRegistry
    let durable: ReturnType<TaskRegistry['listTasks']> = []
    registry = new TaskRegistry({
      sessionId: 'late-effect-restore-failed-child', projectRoot: process.cwd(),
      persistEffectMarker: async () => {
        const snapshot = registry.listTasks()
        if (snapshot.some(record => record.taskId === 'restore-failed-parent'
          && record.effectLedger?.some(effect => effect.tool === 'subagent' && effect.state === 'effect-observed'))) {
          throw new Error('snapshot unavailable during parent promotion')
        }
        durable = snapshot
      },
    })
    const parent = registry.spawn({
      taskId: 'restore-failed-parent', effectPolicy: 'tool-gated', allowDelegation: true,
    }, async context => {
      const parentEffectId = await context.markEffectStarted('subagent')
      registry.spawn({
        taskId: 'restore-failed-child', parentTaskId: context.taskId, parentEffectId,
        effectPolicy: 'tool-gated', maxRetries: 0,
      }, async childContext => {
        const effectId = await childContext.markEffectStarted('write_file')
        await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'f'.repeat(64)}`)
        throw new TaskRuntimeError('FAILED_AFTER_EFFECT', 'Child failed after recording its external effect')
      })
      return 'parent finished before its child'
    })

    await parent.awaitResult()
    await registry.awaitResult('restore-failed-child')
    await registry.awaitIdle()

    expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'unknown' }])
    expect(durable.find(record => record.taskId === 'restore-failed-child')).toMatchObject({
      state: 'failed', effectPolicy: 'tool-gated', effectLedger: [{ tool: 'write_file', state: 'effect-observed' }],
    })
    expect(durable.find(record => record.taskId === 'restore-failed-parent')?.effectLedger?.[0]?.state).toBe('unknown')

    const restored = new TaskRegistry({
      sessionId: 'late-effect-restore-failed-child', projectRoot: process.cwd(), persistEffectMarker: async () => {},
    })
    restored.restoreTasks(durable)
    await restored.awaitIdle()

    expect(restored.getStatus('restore-failed-child')).toMatchObject({ state: 'failed', effectPolicy: 'unknown' })
    expect(restored.getStatus('restore-failed-parent').effectLedger).toMatchObject([{
      tool: 'subagent', state: 'effect-observed',
      evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
    }])
  })

  it('does not emit duplicate late outcomes when terminal records are revisited', async () => {
    let releaseChild!: () => void
    const childGate = new Promise<void>(resolve => { releaseChild = resolve })
    let registry!: TaskRegistry
    registry = new TaskRegistry({
      sessionId: 'late-effect-idempotency', projectRoot: process.cwd(),
      persistEffectMarker: async () => { registry.listTasks() },
    })
    const parent = registry.spawn({ taskId: 'idempotent-effect-parent', effectPolicy: 'tool-gated', allowDelegation: true }, async context => {
      const parentEffectId = await context.markEffectStarted('subagent')
      registry.spawn({ taskId: 'idempotent-effect-child', parentTaskId: context.taskId, parentEffectId, effectPolicy: 'tool-gated' }, async childContext => {
        const effectId = await childContext.markEffectStarted('write_file')
        await childGate
        await childContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'e'.repeat(64)}`)
        return 'child finished'
      })
      return 'parent finished first'
    })

    try {
      await parent.awaitResult()
      await waitFor(() => !(registry as any).tasks.get(parent.taskId).inFlight)
      releaseChild()
      await registry.awaitResult('idempotent-effect-child')
      await registry.awaitIdle()
      await (registry as any).queueEffectPropagation('idempotent-effect-child')
      await registry.awaitIdle()

      expect(parent.status().effectLedger).toMatchObject([{ tool: 'subagent', state: 'effect-observed' }])
      expect(registry.events.list(parent.taskId).filter(event => event.type === 'effect_outcome')).toHaveLength(1)
      const restored = new TaskRegistry({
        sessionId: 'late-effect-idempotency', projectRoot: process.cwd(), persistEffectMarker: async () => {},
      })
      restored.restoreTasks(registry.listTasks(), record => async () => record.result?.value)
      await restored.awaitIdle()
      expect(restored.getStatus(parent.taskId).effectLedger).toMatchObject([{ tool: 'subagent', state: 'effect-observed' }])
      expect(restored.events.list(parent.taskId).filter(event => event.type === 'effect_outcome')).toHaveLength(0)
    } finally {
      releaseChild()
      await registry.awaitIdle()
    }
  })

  it('does not accept automatic no-effect outcomes without durable task storage', async () => {
    const registry = new TaskRegistry({ sessionId: 'no-effect-without-disk', projectRoot: process.cwd() })
    const task = registry.spawn({ taskId: 'no-durable-effect', maxRetries: 0, effectPolicy: 'tool-gated' }, async context => {
      const effectId = await context.markEffectStarted('git')
      await context.markEffectOutcome(effectId, 'no-effect', `git-local-state-unchanged:${'b'.repeat(64)}`)
      return 'must not complete'
    })

    expect((await task.awaitResult()).status).toBe('failed')
    await registry.awaitIdle()
    expect(task.status().effectMayHaveStarted).toBe(true)
    expect(task.status().effectLedger?.[0]?.state).toBe('unknown')
    expect(() => task.resume()).toThrow('reconcile effects')
  })

  it('rolls back the task timestamp when an effect outcome cannot be persisted', async () => {
    let writes = 0
    let outcomeRolledBack = false
    const registry = new TaskRegistry({
      sessionId: 'effect-outcome-rollback', projectRoot: process.cwd(),
      persistEffectMarker: async () => { if (++writes === 2) throw new Error('snapshot unavailable') },
    })
    const task = registry.spawn({ taskId: 'effect-outcome-rollback', maxRetries: 0, effectPolicy: 'tool-gated' }, async context => {
      const effectId = await context.markEffectStarted('git')
      const before = registry.getStatus(context.taskId)
      try { await context.markEffectOutcome(effectId, 'no-effect', `git-local-state-unchanged:${'c'.repeat(64)}`) }
      catch { /* Keep the runner alive so its rolled-back in-memory record can be checked. */ }
      const after = registry.getStatus(context.taskId)
      outcomeRolledBack = after.updatedAt === before.updatedAt
        && after.effectMayHaveStarted === true
        && after.effectLedger?.[0]?.state === 'unknown'
      return 'checked'
    })

    expect((await task.awaitResult()).value).toBe('checked')
    expect(outcomeRolledBack).toBe(true)
  })

  it('restores uncertain effect-ledger entries as effectful if the summary flag is false', async () => {
    const source = new TaskRegistry({ sessionId: 'effect-ledger-restore', projectRoot: process.cwd(), persistEffectMarker: async () => {} })
    const task = source.spawn({ taskId: 'ledger-unknown', maxRetries: 0, effectPolicy: 'tool-gated' }, async context => {
      await context.markEffectStarted('git')
      throw new TaskRuntimeError('UNKNOWN_GIT_RESULT', 'Git result was lost')
    })
    await task.awaitResult()
    await source.awaitIdle()
    const tampered = task.status()
    tampered.effectMayHaveStarted = false

    const restored = new TaskRegistry({ sessionId: 'effect-ledger-restore', projectRoot: process.cwd() })
    restored.restoreTasks([tampered])
    expect(restored.getStatus(task.taskId).effectMayHaveStarted).toBe(true)
    expect(() => restored.resume(task.taskId)).toThrow('reconcile effects')
  })

  it('refuses effect reconciliation while the task runner is still settling', async () => {
    let registry!: TaskRegistry
    let release!: () => void
    registry = new TaskRegistry({
      projectRoot: process.cwd(),
      persistReconciliation: async () => { registry.listTasks() },
    })
    const waiting = new Promise<void>(resolve => { release = resolve })
    const task = registry.spawn({ taskId: 'still-running', maxRetries: 0, effectPolicy: 'tool-gated' }, async context => {
      await context.markEffectStarted('web_fetch')
      await waiting
      return 'late response'
    })
    await waitFor(() => task.status().effectMayHaveStarted === true)
    task.cancel()
    await task.awaitResult()

    await expect(registry.reconcileEffects(task.taskId, 'no-effect', 'I checked the remote state.')).rejects.toThrow('still settling')
    release()
    await registry.awaitIdle()
    await expect(registry.reconcileEffects(task.taskId, 'no-effect', 'I checked the remote state and confirmed no change.')).resolves.toMatchObject({ resolution: 'no-effect' })
  })

  it('records observed or compensated effects without authorizing replay', async () => {
    for (const resolution of ['effect-observed', 'compensated'] as const) {
      let registry!: TaskRegistry
      registry = new TaskRegistry({ projectRoot: process.cwd(), persistReconciliation: async () => { registry.listTasks() } })
      const task = registry.spawn({ taskId: resolution, maxRetries: 1, effectPolicy: 'tool-gated' }, async context => {
        await context.markEffectStarted('write_file')
        throw new TaskRuntimeError('OUTCOME_UNKNOWN', 'unknown')
      })
      await task.awaitResult()
      await registry.awaitIdle()

      await registry.reconcileEffects(task.taskId, resolution, 'I inspected the target and recorded the observed outcome.')
      expect(() => task.resume()).toThrow('reconcile effects')
      expect(task.status().effectReconciliations?.at(-1)?.resolution).toBe(resolution)
    }
  })

  it('does not authorize or retain reconciliation when its durable write fails', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), persistReconciliation: async () => { throw new Error('disk unavailable') } })
    const task = registry.spawn({ taskId: 'failed-reconcile-write', maxRetries: 1, effectPolicy: 'tool-gated' }, async context => {
      await context.markEffectStarted('write_file')
      throw new TaskRuntimeError('OUTCOME_UNKNOWN', 'unknown')
    })
    await task.awaitResult()
    await registry.awaitIdle()

    await expect(registry.reconcileEffects(task.taskId, 'no-effect', 'I inspected the target and no write occurred.')).rejects.toThrow('durably save')
    expect(task.status().effectReconciliations).toBeUndefined()
    expect(() => task.resume()).toThrow('reconcile effects')
  })

  it('requires evidence without known secrets and a durable task snapshot', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })
    const task = registry.spawn({ taskId: 'without-persistence', maxRetries: 0, effectPolicy: 'tool-gated' }, async context => {
      await context.markEffectStarted('write_file')
      throw new TaskRuntimeError('OUTCOME_UNKNOWN', 'unknown')
    })
    await task.awaitResult()
    await registry.awaitIdle()

    await expect(registry.reconcileEffects(task.taskId, 'no-effect', '   ')).rejects.toThrow('evidence')
    await expect(registry.reconcileEffects(task.taskId, 'no-effect', 'Authorization: Bearer synthetic-token-value')).rejects.toThrow('credentials')
    await expect(registry.reconcileEffects(task.taskId, 'no-effect', 'I checked the target and no write occurred.')).rejects.toThrow('durable task snapshot')
    expect(task.status().effectReconciliations).toBeUndefined()
    expect(task.status().effectMayHaveStarted).toBe(true)
  })

  it('marks an unclassified runner and awaits effect persistence before its first instruction', async () => {
    let persisted = false
    let attempts = 0
    let markerWasDurableAtStart = false
    const registry = new TaskRegistry({
      projectRoot: process.cwd(), limits: { retryBackoffMs: 0 },
      persistEffectMarker: async () => { await new Promise(resolve => setTimeout(resolve, 5)); persisted = true },
    })
    const task = registry.spawn({ taskId: 'unclassified-effects', maxRetries: 2 }, async context => {
      attempts++
      markerWasDurableAtStart = persisted && registry.getStatus(context.taskId).effectMayHaveStarted === true
      throw new TaskRuntimeError('TRANSIENT', 'uncertain runner result', true)
    })

    const result = await task.awaitResult()

    expect(result.status).toBe('failed')
    expect(attempts).toBe(1)
    expect(markerWasDurableAtStart).toBe(true)
  })

  it('does not let a fresh retry-safe declaration bypass the effect marker', async () => {
    let persisted = false
    let attempts = 0
    const registry = new TaskRegistry({
      projectRoot: process.cwd(), limits: { retryBackoffMs: 0 },
      persistEffectMarker: async () => { persisted = true },
    })
    const task = registry.spawn({ taskId: 'unverified-retry-safe', maxRetries: 1, effectPolicy: 'retry-safe' } as never, async () => {
      attempts++
      expect(persisted).toBe(true)
      throw new TaskRuntimeError('TRANSIENT', 'uncertain runner result', true)
    })

    const result = await task.awaitResult()

    expect(task.status().effectPolicy).toBe('unknown')
    expect(task.status().effectMayHaveStarted).toBe(true)
    expect(result.error?.retryable).toBe(false)
    expect(attempts).toBe(1)
  })

  it('keeps fresh tool-gated exemptions on the delegated Agent path', async () => {
    const declarations: string[] = []
    for (const file of new Bun.Glob('src/**/*.{ts,tsx}').scanSync()) {
      const source = await readFile(file, 'utf8')
      if (/effectPolicy\s*:\s*['"]tool-gated['"]/.test(source)) declarations.push(file)
    }

    expect(declarations).toEqual(['src/tools/SubAgent/SubAgent.ts'])
  })

  it('does not enter an unclassified runner when its effect marker cannot be persisted', async () => {
    let started = false
    const registry = new TaskRegistry({
      projectRoot: process.cwd(),
      persistEffectMarker: async () => { throw new Error('snapshot unavailable') },
    })
    const task = registry.spawn({ taskId: 'unpersisted-effects', maxRetries: 1 }, async () => {
      started = true
      return 'must not start'
    })

    const result = await task.awaitResult()

    expect(started).toBe(false)
    expect(result.status).toBe('failed')
    expect(task.status().effectMayHaveStarted).toBeUndefined()
  })

  it('releases its scheduler slot when cancellation interrupts effect-marker persistence', async () => {
    let releaseMarker!: () => void
    let markerStarted!: () => void
    const markerEntered = new Promise<void>(resolve => { markerStarted = resolve })
    const markerFlush = new Promise<void>(resolve => { releaseMarker = resolve })
    let unclassifiedRunnerStarted = false
    const registry = new TaskRegistry({
      projectRoot: process.cwd(), limits: { concurrency: 1 },
      persistEffectMarker: async () => { markerStarted(); await markerFlush },
    })
    try {
      const pending = registry.spawn({ taskId: 'pending-marker' }, async () => {
        unclassifiedRunnerStarted = true
        return 'must not start'
      })
      await markerEntered
      expect(pending.cancel()).toBe(true)
      expect((await pending.awaitResult()).status).toBe('cancelled')

      let nextRunnerStarted = false
      const next = registry.spawn({ taskId: 'next-task', effectPolicy: 'tool-gated' }, async () => {
        nextRunnerStarted = true
        return 'started'
      })
      await waitFor(() => nextRunnerStarted)
      expect((await next.awaitResult()).value).toBe('started')
      expect(unclassifiedRunnerStarted).toBe(false)
    } finally {
      releaseMarker()
      await registry.awaitIdle()
    }
  })

  it('treats a legacy restored runner without an effect policy as unclassified', async () => {
    const seed = new TaskRegistry({ sessionId: 'legacy-effect-policy', projectRoot: process.cwd() })
    const completed = seed.spawn({ taskId: 'legacy', effectPolicy: 'tool-gated' }, async () => 'seed')
    await completed.awaitResult()
    const legacy = completed.status()
    legacy.state = 'queued'
    legacy.attempt = 0
    legacy.startedAt = undefined
    legacy.completedAt = undefined
    legacy.deadline = undefined
    legacy.result = undefined
    legacy.error = undefined
    legacy.effectPolicy = undefined

    let persisted = false
    let attempts = 0
    const restored = new TaskRegistry({
      sessionId: 'legacy-effect-policy', projectRoot: process.cwd(),
      persistEffectMarker: async () => { persisted = true },
      limits: { retryBackoffMs: 0 },
    })
    restored.restoreTasks([legacy], () => async () => {
      attempts++
      expect(persisted).toBe(true)
      throw new TaskRuntimeError('TRANSIENT', 'unknown legacy runner', true)
    })

    expect((await restored.awaitResult('legacy')).status).toBe('failed')
    expect(attempts).toBe(1)
    expect(restored.getStatus('legacy').effectMayHaveStarted).toBe(true)
  })

  it('does not trust a serialized retry-safe policy when restoring a task', async () => {
    const seed = new TaskRegistry({ sessionId: 'restored-policy', projectRoot: process.cwd() })
    const completed = seed.spawn({ taskId: 'queued', maxRetries: 2, effectPolicy: 'tool-gated' }, async () => 'seed')
    await completed.awaitResult()
    const queued = completed.status()
    queued.effectPolicy = 'retry-safe'
    queued.state = 'queued'
    queued.attempt = 0
    queued.startedAt = undefined
    queued.completedAt = undefined
    queued.error = undefined
    queued.result = undefined
    queued.effectMayHaveStarted = undefined

    let persisted = false
    let resolvedPolicy: string | undefined
    let attempts = 0
    const restored = new TaskRegistry({
      sessionId: 'restored-policy', projectRoot: process.cwd(),
      persistEffectMarker: async () => { persisted = true },
    })
    restored.restoreTasks([queued], record => {
      resolvedPolicy = record.effectPolicy
      return async context => {
        attempts++
        expect(persisted).toBe(true)
        expect(restored.getStatus(context.taskId).effectMayHaveStarted).toBe(true)
        throw new TaskRuntimeError('TRANSIENT', 'connection lost', true)
      }
    })

    const result = await restored.awaitResult('queued')

    expect(resolvedPolicy).toBe('unknown')
    expect(result.status).toBe('failed')
    expect(result.error?.retryable).toBe(false)
    expect(attempts).toBe(1)
  })

  it('stops retrying the same failure after three attempts without new partial progress', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    let attempts = 0
    const task = registry.spawn({ maxRetries: 4, effectPolicy: 'tool-gated' }, async () => {
      attempts++
      throw new TaskRuntimeError('TRANSIENT_TEST', 'deterministic failure', true)
    })

    const result = await task.awaitResult()

    expect(result.status).toBe('failed')
    expect(result.error?.retryable).toBe(false)
    expect(result.error?.message).toContain('automatic retries stopped after 3 identical failures')
    expect(attempts).toBe(3)
  })

  it('allows identical failures to retry when the task reports changed partial progress', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    let attempts = 0
    const task = registry.spawn({ maxRetries: 2, effectPolicy: 'tool-gated' }, async context => {
      attempts++
      context.setPartial(`hypothesis ${attempts}`)
      if (attempts < 3) throw new TaskRuntimeError('TRANSIENT_TEST', 'same failure', true)
      return 'recovered'
    })

    const result = await task.awaitResult()

    expect(result.value).toBe('recovered')
    expect(attempts).toBe(3)
  })

  it('clears partial output between retry attempts', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    const task = registry.spawn({ maxRetries: 1, effectPolicy: 'tool-gated' }, async context => {
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
    const task = registry.spawn({ maxRetries: 1, effectPolicy: 'tool-gated' }, async () => { throw new TaskRuntimeError('TRANSIENT', 'retry me', true) })
    await waitFor(() => task.status().state === 'queued' && task.status().attempt === 1)
    expect(task.cancel('stop retry')).toBe(true)
    const result = await task.awaitResult()
    expect(result.status).toBe('cancelled')
    expect(result.error?.message).toBe('stop retry')
  })

  it('retries classified transient provider errors but not unclassified failures', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd(), limits: { retryBackoffMs: 0 } })
    for (const permanentError of [new Error('unclassified failure'), Object.assign(new Error('invalid request'), { status: 400 })]) {
      let permanentAttempts = 0
      const permanent = registry.spawn({ maxRetries: 2 }, async () => {
        permanentAttempts++
        throw permanentError
      })
      const permanentResult = await permanent.awaitResult()

      expect(permanentAttempts).toBe(1)
      expect(permanentResult.status).toBe('failed')
      expect(permanentResult.error?.retryable).toBe(false)
    }

    let transientAttempts = 0
    const transientError = Object.assign(new Error('upstream unavailable'), { status: 503 })
    const transient = registry.spawn({ maxRetries: 1, effectPolicy: 'tool-gated' }, async () => {
      transientAttempts++
      if (transientAttempts === 1) throw transientError
      return 'recovered'
    })

    expect((await transient.awaitResult()).value).toBe('recovered')
    expect(transientAttempts).toBe(2)

    let networkAttempts = 0
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    })
    const network = registry.spawn({ maxRetries: 1, effectPolicy: 'tool-gated' }, async () => {
      networkAttempts++
      if (networkAttempts === 1) throw networkError
      return 'reconnected'
    })

    expect((await network.awaitResult()).value).toBe('reconnected')
    expect(networkAttempts).toBe(2)
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
    const task = registry.spawn({ taskId: 'blocked', maxRetries: 1, effectPolicy: 'tool-gated' }, async ({ attempt, signal }) => {
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

  it('fails closed when a configured usage budget cannot be measured', async () => {
    const registry = new TaskRegistry({ projectRoot: process.cwd() })

    const missingTokens = registry.spawn({ taskId: 'missing-tokens', maxTokens: 10, maxRetries: 0 }, async () => 'done')
    expect((await missingTokens.awaitResult()).error?.code).toBe('TOKEN_BUDGET_UNAVAILABLE')

    const incompleteTokens = registry.spawn({ taskId: 'incomplete-tokens', maxTokens: 10, maxRetries: 0 }, async context => {
      registry.updateMetrics(context.taskId, { tokens: 5, usageAvailable: false })
      return 'done'
    })
    expect((await incompleteTokens.awaitResult()).error?.code).toBe('TOKEN_BUDGET_UNAVAILABLE')

    const missingCost = registry.spawn({ taskId: 'missing-cost', maxCostUsd: 1, maxRetries: 0 }, async () => 'done')
    expect((await missingCost.awaitResult()).error?.code).toBe('COST_BUDGET_UNAVAILABLE')

    const incompleteCost = registry.spawn({ taskId: 'incomplete-cost', maxCostUsd: 1, maxRetries: 0 }, async context => {
      registry.updateMetrics(context.taskId, { costUsd: 0.5, costAvailable: false })
      return 'done'
    })
    expect((await incompleteCost.awaitResult()).error?.code).toBe('COST_BUDGET_UNAVAILABLE')

    const measured = registry.spawn({ taskId: 'measured-under-budget', maxTokens: 10, maxCostUsd: 1, maxRetries: 0 }, async context => {
      registry.updateMetrics(context.taskId, { tokens: 5, usageAvailable: true, costUsd: 0.5, costAvailable: true })
      return 'done'
    })
    expect((await measured.awaitResult()).status).toBe('done')

    const unbounded = registry.spawn({ taskId: 'unbounded', maxRetries: 0 }, async () => 'done')
    expect((await unbounded.awaitResult()).status).toBe('done')
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
