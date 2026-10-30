import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkflowManager, type WorkflowAgentRequest } from '../../src/workflows/manager.js'
import { WorkflowApprovalStore, renameReplacing } from '../../src/workflows/storage.js'

setDefaultTimeout(15_000)

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

/** WorkflowManager over a temporary project whose agent calls go to `runAgent`. */
async function setup(agentRunner?: ConstructorParameters<typeof WorkflowManager>[0]['agentRunner']) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
  roots.push(root)
  const project = join(root, 'project')
  await mkdir(project, { recursive: true })
  return new WorkflowManager({
    sessionId: 'session-test', projectRoot: project, baseDirectory: join(root, 'state'),
    providerConfig: { provider: 'deepseek' }, settings: { agents: { concurrency: 4 } }, agentRunner,
  })
}

describe('WorkflowManager', () => {
  test('journals failed agent outcomes and reruns them after a successful prefix', async () => {
    const calls: string[] = []
    let fail = true
    const manager = await setup(async request => {
      calls.push(request.prompt)
      return request.prompt === 'second' && fail
        ? { value: null, error: 'temporary failure', usage: { tokens: 3 } }
        : { value: request.prompt, usage: { tokens: 2 } }
    })
    const script = `export const meta = {name: 'failure-recovery'};
      return [await agent('first'), await agent('second'), await agent('third')];`
    const first = await (await manager.start({ script })).result
    expect(first.result).toEqual(['first', null, 'third'])
    const journal = JSON.parse(await readFile(first.journalPath!, 'utf8'))
    expect(journal.entries[1]).toMatchObject({ status: 'failed', error: 'temporary failure', usage: { tokens: 3, agents: 1 } })
    fail = false
    const resumed = await (await manager.start({ script, resumeFromRunId: first.runId })).result
    expect(resumed.result).toEqual(['first', 'second', 'third'])
    expect(calls).toEqual(['first', 'second', 'third', 'second', 'third'])
  })

  test('strict agent failures fail the run while preserving spent tokens', async () => {
    const manager = await setup(async () => ({ value: null, error: 'required agent failed', usage: { tokens: 9 } }))
    const result = await (await manager.start({ script: `export const meta = {name: 'required-agent'};
      return agent('required', {throwOnError: true});` })).result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('required agent failed')
    expect(result.usage.tokens).toBe(9)
    expect(result.failures).toHaveLength(1)
  })

  test('runner exceptions remain failed journal entries instead of cached nulls', async () => {
    let calls = 0
    const manager = await setup(async () => { calls++; if (calls === 1) throw new Error('runner crashed'); return { value: 'recovered' } })
    const script = `export const meta = {name: 'runner-recovery'}; return agent('read');`
    const first = await (await manager.start({ script })).result
    expect(first.result).toBeNull()
    const second = await (await manager.start({ script, resumeFromRunId: first.runId })).result
    expect(second.result).toBe('recovered')
    expect(calls).toBe(2)
  })

  test('replays a successful null result without rerunning the agent', async () => {
    let calls = 0
    const manager = await setup(async () => { calls++; return { value: null } })
    const script = `export const meta = {name: 'valid-null'}; return agent('read');`
    await (await manager.start({ script })).result
    expect((await (await manager.start({ script })).result).result).toBeNull()
    expect(calls).toBe(1)
  })

  test('does not reuse a legacy completed entry whose run recorded an agent failure', async () => {
    for (const explicit of [false, true]) {
      let calls = 0
      const manager = await setup(async () => {
        calls++
        return calls === 1 ? { value: null, error: 'legacy failure' } : { value: 'recovered' }
      })
      const script = `export const meta = {name: 'legacy-failure'}; return agent('read');`
      const first = await (await manager.start({ script })).result
      const journal = JSON.parse(await readFile(first.journalPath!, 'utf8'))
      journal.entries[0].status = 'completed'
      delete journal.entries[0].error
      await writeFile(first.journalPath!, JSON.stringify(journal))
      const result = await (await manager.start({ script, ...(explicit ? {resumeFromRunId: first.runId} : {}) })).result
      expect(result.result).toBe('recovered')
      expect(calls).toBe(2)
    }
  })

  test('does not cache a child workflow that returned a failed agent result', async () => {
    let calls = 0
    const manager = await setup(async () => {
      calls++
      return calls === 1 ? { value: null, error: 'child failed' } : { value: 'child recovered' }
    })
    manager.options.interactionMode = () => 'auto'
    manager.options.workflowLoader = async () => `export const meta = {name: 'child'}; return agent('read');`
    const script = `export const meta = {name: 'parent-recovery'}; return workflow('child');`
    const first = await (await manager.start({ script })).result
    expect(first.result).toBeNull()
    expect(JSON.parse(await readFile(first.journalPath!, 'utf8')).entries[0]).toMatchObject({ status: 'failed', error: 'child failed' })
    expect((await (await manager.start({ script, resumeFromRunId: first.runId })).result).result).toBe('child recovered')
    expect(calls).toBe(2)
  })

  test('does not cache a child that catches a thrown agent error', async () => {
    const manager = await setup(async () => ({ value: 'recovered' }))
    manager.options.interactionMode = () => 'auto'
    const runAgent = spyOn(manager as any, 'runAgent').mockRejectedValueOnce(new Error('host agent callback failed'))
    manager.options.workflowLoader = async () => `export const meta = {name: 'catching-child'};
      try { return await agent('read'); } catch { return 'caught'; }`
    const script = `export const meta = {name: 'catching-parent'}; return workflow('catching-child');`
    const first = await (await manager.start({ script })).result
    try {
      expect(JSON.parse(await readFile(first.journalPath!, 'utf8')).entries[0]).toMatchObject({ status: 'failed', error: 'host agent callback failed' })
      expect((await (await manager.start({ script, resumeFromRunId: first.runId })).result).result).toBe('recovered')
    } finally { runAgent.mockRestore() }
  })

  test('attributes agent counts to each concurrent child instead of the shared run counter', async () => {
    const manager = await setup(async request => { await Bun.sleep(15); return { value: request.prompt } })
    manager.options.interactionMode = () => 'auto'
    manager.options.workflowLoader = async () => `export const meta = {name: 'child'}; return agent('read');`
    const result = await (await manager.start({ script: `export const meta = {name: 'child-counts'};
      return parallel([() => workflow('child'), () => workflow('child')]);` })).result
    const journal = JSON.parse(await readFile(result.journalPath!, 'utf8'))
    expect(journal.entries.map((entry: {usage: {agents: number}}) => entry.usage.agents)).toEqual([1, 1])
    expect(result.usage.agents).toBe(2)
  })

  test('retains child usage when strict failure is caught by the parent helper', async () => {
    const manager = await setup(async () => ({value: null, error: 'child agent failed', usage: {tokens: 11, costUsd: 0.04}}))
    manager.options.interactionMode = () => 'auto'
    manager.options.workflowLoader = async () => `export const meta = {name: 'strict-child'};
      return agent('read', {throwOnError: true});`
    const result = await (await manager.start({script: `export const meta = {name: 'child-usage'};
      return parallel([() => workflow('strict-child')]);`})).result
    expect(result.result).toEqual([null])
    expect(result.usage).toEqual({agents: 1, tokens: 11, costUsd: 0.04})
    expect((await manager.get(result.runId))?.usage).toEqual(result.usage)
  })

  test('rejects non-boolean throwOnError before spawning an agent', async () => {
    let calls = 0
    const manager = await setup(async () => { calls++; return {value: 'unexpected'} })
    const result = await (await manager.start({script: `export const meta = {name: 'invalid-strict'};
      return parallel([() => agent('read', {throwOnError: 'yes'})]);`})).result
    expect(result.status).toBe('failed')
    expect(result.error).toContain('throwOnError')
    expect(calls).toBe(0)
  })

  test('defaults helper admission to the configured agent concurrency', async () => {
    let running = 0
    let peak = 0
    let release!: () => void
    const admitted = new Promise<void>(resolve => { release = resolve })
    const manager = await setup(async request => {
      running++
      peak = Math.max(peak, running)
      if (running === 4) release()
      await admitted
      running--
      return { value: request.prompt }
    })
    const result = await (await manager.start({ script: `export const meta = {name: 'configured-admission'};
      return parallel(Array.from({length: 7}, (_, i) => () => agent(String(i))));` })).result
    expect(result.result).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(peak).toBe(4)
  })

  test('runs agents, persists usage and exposes status', async () => {
    const requests: Array<{ prompt: string; options: object }> = []
    const manager = await setup(async request => {
      requests.push({ prompt: request.prompt, options: request.options })
      return {
        value: request.options.schema ? { prompt: request.prompt } : `done:${request.prompt}`,
        usage: { tokens: 3, costUsd: 0.01 }, taskId: `task-${request.prompt}`,
        worktree: request.options.isolation === 'worktree' ? '/tmp/worktree-one' : undefined,
      }
    })
    const progress: Array<{ agents: number; tokens: number }> = []
    manager.subscribe(event => progress.push({ agents: event.run.usage.agents, tokens: event.run.usage.tokens }))
    const handle = await manager.start({
      script: `
        export const meta = {"name":"managed"};
        const first = await agent("one", { model: "special", effort: "high", isolation: "worktree" });
        const second = await agent("two", { schema: { type: "object" } });
        return { first, second };
      `,
    })

    const result = await handle.result
    expect(result.status).toBe('completed')
    expect(result.result).toEqual({ first: 'done:one', second: { prompt: 'two' } })
    expect(result.usage).toEqual({ agents: 2, tokens: 6, costUsd: 0.02 })
    expect(requests[0]?.options).toMatchObject({ model: 'special', effort: 'high', isolation: 'worktree' })
    expect(result.worktrees).toEqual([{ taskId: 'task-one', path: '/tmp/worktree-one' }])
    expect(progress).toContainEqual({ agents: 2, tokens: 6 })
    expect((await manager.get(handle.runId))?.status).toBe('completed')
  }, 15_000)

  test('exposes workflow agent tasks while their run is active', async () => {
    let manager: WorkflowManager
    let located: ReturnType<WorkflowManager['findTask']>
    manager = await setup(async request => {
      const task = request.session.spawn({ taskId: 'visible-agent', metadata: { task: 'Inspect', role: 'reader' } }, async () => 'done')
      await task.awaitResult()
      located = manager.findTask(task.taskId)
      return { value: 'done' }
    })

    const handle = await manager.start({ script: 'export const meta = {"name":"visible"}; return agent("Inspect");' })
    await handle.result

    expect(located).toMatchObject({ workflowRunId: handle.runId, task: { taskId: 'visible-agent', state: 'done' } })
    expect(manager.findTask('visible-agent')).toBeUndefined()
  })

  test('replays the completed prefix without rerunning agents', async () => {
    let calls = 0
    const manager = await setup(async request => {
      calls++
      return { value: request.prompt, usage: { tokens: 2 } }
    })
    const script = 'export const meta = {"name":"replay"}; phase("one"); const a = await agent("a"); phase("two"); return [a, await agent("b")];'
    const first = await manager.start({ script })
    expect((await first.result).result).toEqual(['a', 'b'])
    const second = await manager.start({ script })
    expect((await second.result).result).toEqual(['a', 'b'])
    expect(calls).toBe(2)
    expect((await manager.get(second.runId))?.phase).toBe('two')
    expect((await manager.get(second.runId))?.phaseHistory).toEqual(['one', 'two'])
  })

  test('invalidates automatic replay when workspace content or execution configuration changes', async () => {
    let calls = 0
    const manager = await setup(async request => { calls++; return { value: request.prompt } })
    const source = join(manager.options.projectRoot, 'source.ts')
    await writeFile(source, 'const version = "one";\n')
    const script = 'export const meta = {"name":"context-replay"}; return agent("same call");'

    await (await manager.start({ script })).result
    await writeFile(source, 'const version = "two";\n')
    await (await manager.start({ script })).result
    expect(calls).toBe(2)

    manager.configure({ model: 'different-model' })
    await (await manager.start({ script })).result
    expect(calls).toBe(3)
    await (await manager.start({ script })).result
    expect(calls).toBe(3)
  })

  test('refuses explicit replay when the workspace has changed', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const source = join(manager.options.projectRoot, 'source.ts')
    await writeFile(source, 'const version = "one";\n')
    const script = 'export const meta = {"name":"stale-context"}; return agent("same call");'
    const first = await manager.start({ script })
    await first.result
    await writeFile(source, 'const version = "two";\n')

    await expect(manager.start({ script, resumeFromRunId: first.runId })).rejects.toThrow('workspace or execution configuration changed')
  })

  test('persists a new phase without interrupting runtime delivery on a transient write failure', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const errors: string[] = []
    manager.setCallbacks({ onError: (_runId, message) => errors.push(message) })
    const store = (manager as unknown as { store: { writeRun(run: { phaseHistory?: string[] }): Promise<void> } }).store
    const writeRun = store.writeRun.bind(store)
    let failPhaseWrite = true
    store.writeRun = async run => {
      if (failPhaseWrite && run.phaseHistory?.includes('one')) {
        failPhaseWrite = false
        throw new Error('temporary phase write failure')
      }
      await writeRun(run)
    }

    const result = await (await manager.start({ script: 'export const meta = {"name":"phase-persist"}; phase("one"); return agent("ok");' })).result

    expect(result.status).toBe('completed')
    expect(errors).toContainEqual(expect.stringContaining('temporary phase write failure'))
    expect((await manager.get(result.runId))?.phaseHistory).toEqual(['one'])
  })

  test('matches replay options and preserves them on restart', async () => {
    let calls = 0
    const manager = await setup(async request => { calls++; return { value: request.prompt } })
    const script = 'export const meta = {"name":"replay-options"}; return [await agent("a"), await agent("b")];'
    const first = await manager.start({ script, maxTokens: 100 })
    await first.result
    const different = await manager.start({ script, maxTokens: 200 })
    await different.result
    expect(calls).toBe(4)
    expect((await (await manager.restart(first.runId)).result).result).toEqual(['a', 'b'])
    expect(calls).toBe(4)
  })

  test('reexecutes a divergent journal entry and its suffix', async () => {
    let calls = 0
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'replay-divergence', projectRoot: project, baseDirectory: state,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => { calls++; return { value: request.prompt } },
    })
    const script = 'export const meta = {"name":"divergence"}; return [await agent("a"), await agent("b")];'
    const first = await manager.start({ script })
    await first.result
    const journalPath = join(state, first.runId, 'journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries[1].fingerprint = 'diverged'
    await writeFile(journalPath, JSON.stringify(journal))

    const second = await manager.start({ script })
    expect((await second.result).result).toEqual(['a', 'b'])
    expect(calls).toBe(3)
  })

  test('recovers from a corrupt replay journal by rerunning it', async () => {
    let calls = 0
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'replay-corruption', projectRoot: project, baseDirectory: state,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => { calls++; return { value: request.prompt } },
    })
    const script = 'export const meta = {"name":"corruption"}; return [await agent("a"), await agent("b")];'
    const first = await manager.start({ script })
    await first.result
    await writeFile(join(state, first.runId, 'journal.json'), '{broken')

    const second = await manager.start({ script })
    expect((await second.result).result).toEqual(['a', 'b'])
    expect(calls).toBe(4)
  })

  test('reexecutes the first incomplete journal call and its suffix', async () => {
    let calls = 0
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'replay-incomplete', projectRoot: project, baseDirectory: state,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => { calls++; return { value: request.prompt } },
    })
    const script = 'export const meta = {"name":"incomplete"}; return [await agent("a"), await agent("b")];'
    const first = await manager.start({ script })
    await first.result
    const journalPath = join(state, first.runId, 'journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries[1].status = 'running'
    await writeFile(journalPath, JSON.stringify(journal))

    const second = await manager.start({ script })
    expect((await second.result).result).toEqual(['a', 'b'])
    expect(calls).toBe(3)
  })

  test('pauses admission of new calls and resumes them', async () => {
    let releaseFirst = () => {}
    const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve })
    const calls: string[] = []
    let secondAdmittedAt = 0n
    let markSecondAdmitted = () => {}
    const secondAdmitted = new Promise<void>(resolve => { markSecondAdmitted = resolve })
    const manager = await setup(async request => {
      calls.push(request.prompt)
      if (request.prompt === 'one') await firstBlocked
      else { secondAdmittedAt = process.hrtime.bigint(); markSecondAdmitted() }
      return { value: request.prompt }
    })
    const handle = await manager.start({ script: 'export const meta = {"name":"pause"}; await agent("one"); return agent("two");' })
    while (calls.length === 0) await Bun.sleep(5)
    expect(await manager.pause(handle.runId)).toBe(true)
    releaseFirst()
    expect(await manager.resume(handle.runId)).toBe(true)
    const resumeReturnedAt = process.hrtime.bigint()
    await secondAdmitted
    expect(secondAdmittedAt).toBeGreaterThan(resumeReturnedAt)
    expect((await handle.result).status).toBe('completed')
    expect(calls).toEqual(['one', 'two'])
  })

  test('fails a workflow that exceeds the 17-agent cap', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const handle = await manager.start({
      script: 'export const meta = {"name":"cap"}; return parallel(Array.from({length: 18}, (_, i) => () => agent(String(i))));',
    })
    const result = await handle.result
    expect(result.status).toBe('failed')
    expect(result.failures.some(failure => failure.message.includes('17'))).toBe(true)
  })

  test('composes one child workflow and rejects deeper nesting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    const scripts: Record<string, string> = {
      child: 'export const meta = {"name":"child"}; return agent("child-agent");',
    }
    const manager = new WorkflowManager({
      sessionId: 'child-session', projectRoot: project, baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
      workflowLoader: async name => scripts[name],
    })
    const approval = spyOn(WorkflowApprovalStore.prototype, 'isApproved').mockResolvedValue(false)
    try {
      const unapproved = await manager.start({ script: 'export const meta = {"name":"parent-unapproved"}; return workflow("child", {});' })
      expect((await unapproved.result).failures).toContainEqual(expect.objectContaining({ message: expect.stringContaining('requires approval') }))

      approval.mockResolvedValue(true)
      const handle = await manager.start({ script: 'export const meta = {"name":"parent"}; return workflow("child", {});' })
      expect((await handle.result).result).toBe('child-agent')

      scripts.child = 'export const meta = {"name":"child"}; return workflow("grandchild", {});'
      const failed = await manager.start({ script: 'export const meta = {"name":"parent-two"}; return workflow("child", {});' })
      expect((await failed.result).status).toBe('failed')
    } finally { approval.mockRestore() }
  })

  test('keeps completion observable when final persistence fails', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const errors: string[] = []
    manager.setCallbacks({ onError: (_id, error) => errors.push(error) })
    const store = (manager as unknown as { store: { writeRun(run: { status: string }): Promise<void> } }).store
    const writeRun = store.writeRun.bind(store)
    store.writeRun = async run => {
      if (run.status === 'completed') throw new Error('disk full')
      await writeRun(run)
    }

    const result = await (await manager.start({ script: 'export const meta = {"name":"persist-failure"}; return agent("ok");' })).result
    expect(result.status).toBe('completed')
    expect(errors).toContainEqual(expect.stringContaining('disk full'))
  })

  test('records the captured call index for parallel agent failures', async () => {
    const manager = await setup(async request => {
      if (request.prompt === 'first') await Bun.sleep(10)
      return { value: null, error: `failed:${request.prompt}` }
    })
    const result = await (await manager.start({
      script: 'export const meta = {"name":"failure-index"}; return parallel([() => agent("first"), () => agent("second")]);',
    })).result
    expect(result.failures.map(failure => failure.call).sort((a, b) => a - b)).toEqual([0, 1])
  })

  test('stops admitting agents after the token budget is exhausted', async () => {
    let calls = 0
    const manager = await setup(async request => { calls++; return { value: request.prompt, usage: { tokens: 3 } } })
    const handle = await manager.start({
      script: 'export const meta = {"name":"budget"}; return [await agent("one"), await agent("two")];',
      maxTokens: 2,
    })
    const result = await handle.result
    expect(result.status).toBe('budget_exhausted')
    expect(result.result).toEqual(['one', null])
    expect(calls).toBe(1)

    const replay = await manager.start({
      script: 'export const meta = {"name":"budget"}; return [await agent("one"), await agent("two")];',
      maxTokens: 2,
    })
    expect((await replay.result).status).toBe('budget_exhausted')
    expect(calls).toBe(1)
  })

  test('shares an explicit workflow budget across parallel agents', async () => {
    let active = 0
    let peak = 0
    const requests: WorkflowAgentRequest[] = []
    const manager = await setup(async request => {
      requests.push(request)
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { value: request.prompt, usage: { tokens: 3, costUsd: 0.02 } }
    })

    const result = await (await manager.start({
      script: 'export const meta = {"name":"parallel-budget"}; return parallel([() => agent("one"), () => agent("two")]);',
      maxTokens: 2,
      maxCostUsd: 0.01,
    })).result

    expect(result.status).toBe('budget_exhausted')
    expect(result.result).toEqual(['one', null])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.options).toMatchObject({ maxTokens: 2, maxCostUsd: 0.01 })
    expect(peak).toBe(1)
  })

  test('passes each worker only the remaining run budget and preserves lower worker caps', async () => {
    const requests: WorkflowAgentRequest[] = []
    const manager = await setup(async request => {
      requests.push(request)
      return { value: request.prompt, usage: { tokens: 10, costUsd: 0.1 } }
    })

    const result = await (await manager.start({
      script: 'export const meta = {"name":"remaining-budget"}; await agent("one"); await agent("two"); return agent("three", { maxTokens: 5, maxCostUsd: 0.02 });',
      maxTokens: 100,
      maxCostUsd: 1,
    })).result

    expect(result.status).toBe('completed')
    expect(requests.map(request => request.options)).toEqual([
      { maxTokens: 100, maxCostUsd: 1 },
      { maxTokens: 90, maxCostUsd: 0.9 },
      { maxTokens: 5, maxCostUsd: 0.02 },
    ])
  })

  test('does not start budget-queued workers after run cancellation', async () => {
    let calls = 0
    let markStarted!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const manager = await setup(async request => {
      calls++
      if (calls === 1) {
        markStarted()
        await new Promise<never>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }))
      }
      return { value: request.prompt, usage: { tokens: 1 } }
    })

    const handle = await manager.start({
      script: 'export const meta = {"name":"cancel-budget-queue"}; return parallel([() => agent("one"), () => agent("two")]);',
      maxTokens: 100,
    })
    await started
    expect(await manager.cancel(handle.runId)).toBe(true)
    expect((await handle.result).status).toBe('cancelled')
    expect(calls).toBe(1)
  })

  test('cancels a running workflow and terminates its worker', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const handle = await manager.start({ script: 'export const meta = {"name":"cancel"}; await new Promise(() => {});' })
    expect(await manager.cancel(handle.runId)).toBe(true)
    expect((await handle.result).status).toBe('cancelled')
  })

  test('treats invalid agent options as a structural failure', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const handle = await manager.start({
      script: 'export const meta = {"name":"invalid-options"}; return parallel([() => agent("x", { effort: "extreme" })]);',
    })
    const result = await handle.result
    expect(result.status).toBe('failed')
    expect(result.failures.some(failure => failure.message.includes('effort'))).toBe(true)
  })

  test('blocks writer isolation in plan mode while allowing reader agents', async () => {
    let calls = 0
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    const manager = new WorkflowManager({
      sessionId: 'plan-mode', projectRoot: project, baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, interactionMode: () => 'plan',
      agentRunner: async request => { calls++; expect(request.interactionMode).toBe('plan'); return { value: request.prompt } },
    })
    const writer = await manager.start({ script: 'export const meta = {"name":"writer"}; return agent("write", { isolation: "worktree" });' })
    expect((await writer.result).status).toBe('failed')
    const reader = await manager.start({ script: 'export const meta = {"name":"reader"}; return agent("read");' })
    expect((await reader.result).result).toBe('read')
    expect(calls).toBe(1)
  })

  test('saves ad-hoc runs as named workflows without overwriting files', async () => {
    const manager = await setup(async request => ({ value: request.prompt }))
    const handle = await manager.start({ script: 'return args.answer;', name: 'adhoc', args: { answer: 42 } })
    await handle.result
    const path = await manager.save(handle.runId, 'saved-workflow')
    expect(await readFile(path, 'utf8')).toContain('export const meta = {"name":"saved-workflow"};')
    await expect(manager.save(handle.runId, 'saved-workflow')).rejects.toThrow()
  })
})

describe('WorkflowManager — Claude Code parity', () => {
  test('resumeFromRunId replays the unchanged prefix of an edited script', async () => {
    const calls: string[] = []
    const manager = await setup(async request => { calls.push(request.prompt); return { value: `done:${request.prompt}`, usage: { tokens: 1 } } })
    const first = await manager.start({ script: 'export const meta = {"name":"resume"}; return [await agent("a"), await agent("b")];' })
    expect((await first.result).result).toEqual(['done:a', 'done:b'])

    const edited = 'export const meta = {"name":"resume"}; return [await agent("a"), await agent("b-edited"), await agent("c")];'
    const second = await manager.start({ script: edited, resumeFromRunId: first.runId.slice(0, 8) })
    const result = await second.result
    expect(result.result).toEqual(['done:a', 'done:b-edited', 'done:c'])
    expect(calls).toEqual(['a', 'b', 'b-edited', 'c'])
    expect(result.scriptPath).toEndWith(join(second.runId, 'workflow.js'))
    expect(result.journalPath).toEndWith(join(second.runId, 'journal.json'))
    await expect(manager.start({ script: edited, resumeFromRunId: 'ffffffff' })).rejects.toThrow('no journal')
  })

  test('resolves scripts from source, saved names and contained script paths only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(join(project, '.deepseek', 'workflows'), { recursive: true })
    await writeFile(join(project, '.deepseek', 'workflows', 'saved.js'), 'export const meta = {"name":"saved"}; return "saved";')
    await writeFile(join(root, 'outside.js'), 'export const meta = {"name":"outside"}; return "outside";')
    const manager = new WorkflowManager({
      sessionId: 'resolve', projectRoot: project, baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })

    expect(await manager.resolveScript({ script: 'return 1;', name: 'adhoc' })).toEqual({ script: 'return 1;', name: 'adhoc' })
    expect((await manager.resolveScript({ name: 'saved' })).script).toContain('"saved"')
    expect((await manager.resolveScript({ scriptPath: '.deepseek/workflows/saved.js' })).script).toContain('"saved"')
    await expect(manager.resolveScript({ scriptPath: join(root, 'outside.js') })).rejects.toThrow('inside the project')
    await expect(manager.resolveScript({ name: 'missing' })).rejects.toThrow('not found')
    await expect(manager.resolveScript({})).rejects.toThrow('Provide a workflow script')

    // A previous run's persisted script is a valid scriptPath — that is how resume iterates.
    const run = await manager.start({ script: 'export const meta = {"name":"persisted"}; return agent("x");' })
    const result = await run.result
    expect((await manager.resolveScript({ scriptPath: result.scriptPath! })).script).toContain('"persisted"')
  })

  test('runs { scriptPath } children in Auto mode without prior approval and groups their phases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 'child.js'), 'export const meta = {"name":"child"}; phase("inner"); return agent("child-agent", { phase: "tagged" });')
    const manager = new WorkflowManager({
      sessionId: 'auto-child', projectRoot: project, baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, interactionMode: () => 'auto',
      agentRunner: async request => ({ value: request.prompt }),
    })
    const approval = spyOn(WorkflowApprovalStore.prototype, 'isApproved').mockResolvedValue(false)
    try {
      const handle = await manager.start({ script: 'export const meta = {"name":"parent"}; return workflow({ scriptPath: "child.js" }, {});' })
      const result = await handle.result
      expect(result.status).toBe('completed')
      expect(result.result).toBe('child-agent')
      expect((await manager.get(handle.runId))?.phaseHistory).toEqual(['▸ child', '▸ child · inner', 'tagged'])
    } finally { approval.mockRestore() }
  })

  test('applies meta.phases[].model to agents without an override and maps Claude Code effort tiers', async () => {
    const seen: Array<{ model?: string; effort?: string }> = []
    const manager = await setup(async request => { seen.push({ model: request.options.model, effort: request.options.effort }); return { value: request.prompt } })
    const handle = await manager.start({
      script: `
        export const meta = {"name":"phase-model","phases":[{"title":"Scan","model":"cheap"},{"title":"Judge"}]};
        phase("Scan");
        await agent("a", { effort: "medium" });
        await agent("b", { model: "own", effort: "xhigh" });
        phase("Judge");
        await agent("c");
        return null;
      `,
    })
    expect((await handle.result).status).toBe('completed')
    expect(seen).toEqual([{ model: 'cheap', effort: 'medium' }, { model: 'own', effort: 'xhigh' }, { model: undefined, effort: undefined }])
    const { toSubagentEffort } = await import('../../src/workflows/manager.js')
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map(level => toSubagentEffort(level as never))).toEqual(['low', 'high', 'high', 'max', 'max'])
  })
})

describe('WorkflowManager — budget replay', () => {
  test('re-executes budget-exhausted journal entries when the new run has room, and counts one agent per call', async () => {
    let calls = 0
    const manager = await setup(async request => { calls++; return { value: request.prompt, usage: { tokens: 3 } } })
    const script = 'export const meta = {"name":"budget-replay"}; return parallel([() => agent("one"), () => agent("two")]);'
    const starved = await (await manager.start({ script, maxTokens: 2 })).result
    expect(starved.status).toBe('budget_exhausted')
    expect(starved.error).toContain('Budget of 2 tokens exhausted')
    expect(starved.error).toContain('resumeFromRunId')
    expect(starved.usage.agents).toBe(1)
    expect(starved.usage.tokens).toBe(3)

    const roomy = await (await manager.start({ script, maxTokens: 100, resumeFromRunId: starved.runId })).result
    expect(roomy.status).toBe('completed')
    expect(roomy.result).toEqual(['one', 'two'])
    expect(roomy.usage).toEqual({ agents: 2, tokens: 6, costUsd: 0 })
    expect(calls).toBe(2)
    expect((await manager.get(roomy.runId))?.usage.agents).toBe(2)
  })
})

describe('WorkflowManager — interrupted runs', () => {
  test('restart resumes an interrupted run over its journal instead of rerunning completed agents', async () => {
    let calls = 0
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
    roots.push(root)
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'interrupted', projectRoot: project, baseDirectory: state,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => { calls++; return { value: request.prompt } },
    })
    const script = 'export const meta = {"name":"interrupted"}; return [await agent("a"), await agent("b")];'
    const first = await (await manager.start({ script })).result
    expect(calls).toBe(2)
    // Simulate a session that died mid-run: the record never reached a terminal status.
    const runPath = join(state, first.runId, 'run.json')
    const run = JSON.parse(await readFile(runPath, 'utf8'))
    run.status = 'running'
    await writeFile(runPath, JSON.stringify(run))
    const journalPath = join(state, first.runId, 'journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries[1].status = 'running'
    await writeFile(journalPath, JSON.stringify(journal))

    const resumed = await (await manager.restart(first.runId.slice(0, 8))).result
    expect(resumed.status).toBe('completed')
    expect(resumed.result).toEqual(['a', 'b'])
    expect(calls).toBe(3)
  })
})

describe('renameReplacing', () => {
  /** Error carrying a Node errno code. */
  const busy = (code: string) => Object.assign(new Error(code), { code })

  test('retries a Windows rename blocked by a reader until it succeeds', async () => {
    let calls = 0
    await renameReplacing('a', 'b', { platform: 'win32', renameFile: async () => { if (++calls < 3) throw busy('EPERM') } })
    expect(calls).toBe(3)
  })

  test('fails fast off Windows and for unrelated errors', async () => {
    let calls = 0
    /** Rename that always fails with EPERM. */
    const failing = async () => { calls++; throw busy('EPERM') }
    await expect(renameReplacing('a', 'b', { platform: 'linux', renameFile: failing })).rejects.toThrow('EPERM')
    await expect(renameReplacing('a', 'b', { platform: 'win32', renameFile: async () => { calls++; throw busy('ENOENT') } })).rejects.toThrow('ENOENT')
    expect(calls).toBe(2)
  })

  test('gives up after the attempt limit', async () => {
    let calls = 0
    await expect(renameReplacing('a', 'b', { platform: 'win32', attempts: 3, renameFile: async () => { calls++; throw busy('EBUSY') } })).rejects.toThrow('EBUSY')
    expect(calls).toBe(3)
  })
})
