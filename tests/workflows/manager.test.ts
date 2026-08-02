import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkflowManager } from '../../src/workflows/manager.js'
import { WorkflowApprovalStore } from '../../src/workflows/storage.js'

setDefaultTimeout(15_000)

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function setup(agentRunner?: ConstructorParameters<typeof WorkflowManager>[0]['agentRunner']) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-manager-'))
  roots.push(root)
  return new WorkflowManager({
    sessionId: 'session-test', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
    providerConfig: { provider: 'deepseek' }, settings: { agents: { concurrency: 4 } }, agentRunner,
  })
}

describe('WorkflowManager', () => {
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
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'replay-divergence', projectRoot: join(root, 'project'), baseDirectory: state,
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
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'replay-corruption', projectRoot: join(root, 'project'), baseDirectory: state,
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
    const state = join(root, 'state')
    const manager = new WorkflowManager({
      sessionId: 'replay-incomplete', projectRoot: join(root, 'project'), baseDirectory: state,
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
    const scripts: Record<string, string> = {
      child: 'export const meta = {"name":"child"}; return agent("child-agent");',
    }
    const manager = new WorkflowManager({
      sessionId: 'child-session', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
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
    const manager = new WorkflowManager({
      sessionId: 'plan-mode', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
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
