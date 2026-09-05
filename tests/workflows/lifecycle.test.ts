import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireFileLease } from '../../src/orchestration/fileLease.js'
import { WorkflowManager } from '../../src/workflows/manager.js'
import { workflowLeaseLockResource, WorkflowStore } from '../../src/workflows/storage.js'
import type { WorkflowRun } from '../../src/workflows/types.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

function run(projectRoot: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: overrides.runId ?? 'deadbeef', sessionId: overrides.sessionId ?? 'old-session', projectRoot,
    meta: { name: 'historical' }, status: overrides.status ?? 'running', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {},
    createdAt: overrides.createdAt ?? '2026-08-01T00:00:00.000Z', startedAt: '2026-08-01T00:00:01.000Z',
    usage: { agents: 1, tokens: 3, costUsd: 0 }, failures: [], worktrees: [], ...overrides,
  }
}

/** Build a production-shaped project store without touching the real ~/.deepseek tree. */
function testStore(root: string, sessionId: string): WorkflowStore {
  const projectRoot = join(root, 'project')
  const store = new WorkflowStore({ projectRoot, sessionId })
  const projectDirectory = join(root, 'project-state')
  Object.defineProperties(store, {
    projectDirectory: { value: projectDirectory },
    root: { value: join(projectDirectory, sessionId, 'workflows') },
  })
  return store
}

async function persistRun(store: WorkflowStore, record: WorkflowRun): Promise<void> {
  const directory = join(store.projectDirectory, record.sessionId, 'workflows', record.runId)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'run.json'), JSON.stringify(record))
  await writeFile(join(directory, 'journal.json'), JSON.stringify({
    schemaVersion: 1, scriptHash: record.scriptHash, argsHash: record.argsHash, optionsHash: record.optionsHash, entries: [],
  }))
  await writeFile(join(directory, 'workflow.js'), 'export const meta = {"name":"history"}; return "history";')
  await writeFile(join(directory, 'args.json'), '{}')
}

describe('workflow activity lifecycle', () => {
  test('persists a terminal startup failure after the run directory was created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const manager = new WorkflowManager({
      sessionId: 'startup-failure-session', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const store = (manager as unknown as { store: WorkflowStore }).store
    store.acquireRunLease = async () => { throw new Error('lease unavailable') }

    await expect(manager.start({ script: 'export const meta = {"name":"startup-failure"}; return 1' })).rejects.toThrow('lease unavailable')
    const runs = await store.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'failed', error: 'lease unavailable' })
  })

  test('shutdown waits for a run whose startup is still persisting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const manager = new WorkflowManager({
      sessionId: 'startup-session', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const store = (manager as unknown as { store: WorkflowStore }).store
    const published: string[] = []
    manager.subscribe(event => published.push(event.run.status))
    const originalCreateRun = store.createRun.bind(store)
    let started!: () => void
    const createStarted = new Promise<void>(resolve => { started = resolve })
    let release!: () => void
    const createGate = new Promise<void>(resolve => { release = resolve })
    store.createRun = async (...args) => {
      started()
      await createGate
      await originalCreateRun(...args)
    }

    const startPromise = manager.start({ script: 'export const meta = {"name":"startup-race"}; await new Promise(() => {});' })
    await createStarted
    expect((await manager.listActiveRuns()).some(run => run.status === 'queued')).toBe(true)
    expect(published).toContain('queued')
    let shutdownFinished = false
    const shutdownPromise = manager.shutdown('test shutdown').then(() => { shutdownFinished = true })
    await Bun.sleep(25)
    let assertionError: unknown
    try { expect(shutdownFinished).toBe(false) } catch (error) { assertionError = error }

    release()
    const handle = await startPromise
    await shutdownPromise
    if (assertionError) {
      await manager.cancel(handle.runId).catch(() => false)
      await handle.result.catch(() => undefined)
      throw assertionError
    }
    expect((await handle.result).status).toBe('cancelled')
    expect(manager.hasActiveRuns()).toBe(false)
  })

  test('cleans up the lease and active map when session shutdown fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const manager = new WorkflowManager({
      sessionId: 'shutdown-session', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const handle = await manager.start({ script: 'export const meta = {"name":"shutdown-failure"}; await new Promise(() => {});' })
    const active = (manager as unknown as { active: Map<string, { session: { shutdown: (reason?: string) => Promise<void> } }> }).active.get(handle.runId)
    expect(active).toBeDefined()
    active!.session.shutdown = async () => { throw new Error('session flush failed') }
    expect(await manager.cancel(handle.runId)).toBe(true)

    const result = await handle.result
    expect(result.status).toBe('cancelled')
    expect(manager.hasActiveRuns()).toBe(false)
    await expect(readFile(join(root, 'state', handle.runId, 'lease.json'), 'utf8')).rejects.toThrow()
  })

  test('finds live runs outside the bounded replay history window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const oldStore = testStore(root, 'old-session')
    const live = run(oldStore.options.projectRoot, { runId: 'long-lived', createdAt: '2026-01-01T00:00:00.000Z' })
    await persistRun(oldStore, live)
    const directory = join(oldStore.projectDirectory, 'old-session', 'workflows', live.runId)
    await writeFile(join(directory, 'lease.json'), JSON.stringify({
      schemaVersion: 1, runId: live.runId, sessionId: live.sessionId, pid: process.pid,
      token: 'live-token', startedAt: new Date(Date.now() - 1_000).toISOString(), heartbeatAt: new Date().toISOString(),
    }))
    for (let index = 0; index < 101; index++) {
      await persistRun(oldStore, run(oldStore.options.projectRoot, {
        runId: `later-${index.toString(16).padStart(4, '0')}`,
        status: 'completed', createdAt: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
      }))
    }
    const manager = new WorkflowManager({
      sessionId: 'new-session', projectRoot: oldStore.options.projectRoot,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const currentStore = (manager as unknown as { store: WorkflowStore }).store
    Object.defineProperties(currentStore, {
      projectDirectory: { value: oldStore.projectDirectory },
      root: { value: join(oldStore.projectDirectory, 'new-session', 'workflows') },
    })

    expect((await manager.listActiveRuns()).map(item => item.runId)).toContain(live.runId)
    expect((await manager.listActivityRuns()).map(item => item.runId)).toContain(live.runId)
  })

  test('keeps historical active records for restart but excludes them from live activity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const oldStore = testStore(root, 'old-session')
    await persistRun(oldStore, run(oldStore.options.projectRoot))
    const manager = new WorkflowManager({
      sessionId: 'new-session', projectRoot: oldStore.options.projectRoot,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const currentStore = (manager as unknown as { store: WorkflowStore }).store
    Object.defineProperties(currentStore, {
      projectDirectory: { value: oldStore.projectDirectory },
      root: { value: join(oldStore.projectDirectory, 'new-session', 'workflows') },
    })

    expect((await manager.list()).map(record => record.runId)).toEqual(['deadbeef'])
    expect(await manager.listActiveRuns()).toEqual([])
    expect(await manager.listActivityRuns()).toEqual([])
    expect((await manager.get('deadbeef'))?.status).toBe('running')
    const restarted = await manager.restart('deadbeef'); await expect(restarted.result).resolves.toMatchObject({ status: expect.any(String) })
  })

  test('retains a fresh lease owned by another live session as active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const oldStore = testStore(root, 'old-session')
    const record = run(oldStore.options.projectRoot, { runId: 'facebeef' })
    await persistRun(oldStore, record)
    const directory = join(oldStore.projectDirectory, 'old-session', 'workflows', record.runId)
    await writeFile(join(directory, 'lease.json'), JSON.stringify({
      schemaVersion: 1, runId: record.runId, sessionId: record.sessionId, pid: process.pid,
      token: 'live-token', startedAt: new Date(Date.now() - 1_000).toISOString(), heartbeatAt: new Date().toISOString(),
    }))
    const manager = new WorkflowManager({
      sessionId: 'new-session', projectRoot: oldStore.options.projectRoot,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const currentStore = (manager as unknown as { store: WorkflowStore }).store
    Object.defineProperties(currentStore, {
      projectDirectory: { value: oldStore.projectDirectory },
      root: { value: join(oldStore.projectDirectory, 'new-session', 'workflows') },
    })

    expect((await manager.listActiveRuns()).map(item => item.runId)).toEqual(['facebeef'])
    await expect(manager.restart('facebeef')).rejects.toThrow('still active')
  })

  test('discovers a session created after the first activity scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const currentStore = testStore(root, 'current-session')
    expect(await currentStore.listRuns()).toEqual([])

    const laterStore = testStore(root, 'later-session')
    const record = run(laterStore.options.projectRoot, { runId: 'newbeef', sessionId: 'later-session' })
    await persistRun(laterStore, record)

    expect((await currentStore.listRuns()).map(item => item.runId)).toEqual(['newbeef'])
  })

  test('does not steal an expired lease or rewrite its running history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const oldStore = testStore(root, 'old-session')
    const record = run(oldStore.options.projectRoot, { runId: 'deadbead' })
    await persistRun(oldStore, record)
    const directory = join(oldStore.projectDirectory, 'old-session', 'workflows', record.runId)
    const heartbeatAt = new Date(Date.now() - 60_000).toISOString()
    await writeFile(join(directory, 'lease.json'), JSON.stringify({
      schemaVersion: 1, runId: record.runId, sessionId: record.sessionId, pid: process.pid,
      token: 'stale-token', startedAt: heartbeatAt, heartbeatAt,
    }))
    const manager = new WorkflowManager({
      sessionId: 'new-session', projectRoot: oldStore.options.projectRoot,
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })
    const currentStore = (manager as unknown as { store: WorkflowStore }).store
    Object.defineProperties(currentStore, {
      projectDirectory: { value: oldStore.projectDirectory },
      root: { value: join(oldStore.projectDirectory, 'new-session', 'workflows') },
    })

    expect(await manager.listActiveRuns()).toEqual([])
    expect((await manager.get('deadbead'))?.status).toBe('running')
    expect(JSON.parse(await readFile(join(directory, 'run.json'), 'utf8')).status).toBe('running')
    expect(JSON.parse(await readFile(join(directory, 'lease.json'), 'utf8')).token).toBe('stale-token')
  })

  test('cannot heartbeat or release a lease after ownership changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const store = new WorkflowStore({ projectRoot: join(root, 'project'), sessionId: 'lease-session', baseDirectory: join(root, 'state') })
    await mkdir(store.runDirectory('lease-run'), { recursive: true })
    const lease = await store.acquireRunLease('lease-run', 'lease-session')
    const replacement = { ...lease, token: 'replacement-token', heartbeatAt: new Date().toISOString() }
    await writeFile(store.leasePath('lease-run'), JSON.stringify(replacement))

    expect(await store.heartbeatRunLease(lease)).toBe(false)
    await store.releaseRunLease(lease)
    expect(JSON.parse(await readFile(store.leasePath('lease-run'), 'utf8')).token).toBe('replacement-token')
  })

  test('does not heartbeat over a replacement owner between read and write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const store = new WorkflowStore({ projectRoot: join(root, 'project'), sessionId: 'lease-session', baseDirectory: join(root, 'state') })
    await mkdir(store.runDirectory('heartbeat-run'), { recursive: true })
    const oldLease = await store.acquireRunLease('heartbeat-run', 'old-session')
    const replacement = { ...oldLease, sessionId: 'new-session', token: 'new-owner-token', heartbeatAt: new Date().toISOString() }
    const lock = await acquireFileLease(workflowLeaseLockResource(store.leasePath('heartbeat-run')))
    let unblock!: () => void
    const mutation = new Promise<void>(resolve => { unblock = resolve })
    const originalRename = fs.rename
    const renameSpy = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === store.leasePath('heartbeat-run')) await mutation
      return originalRename(from, to)
    })
    try {
      const pending = store.heartbeatRunLease(oldLease)
      await Bun.sleep(25)
      await writeFile(store.leasePath('heartbeat-run'), JSON.stringify(replacement))
      await lock.release()
      unblock()
      expect(await pending).toBe(false)
      expect(JSON.parse(await readFile(store.leasePath('heartbeat-run'), 'utf8')).token).toBe('new-owner-token')
    } finally {
      unblock()
      renameSpy.mockRestore()
      await lock.release().catch(() => undefined)
    }
  })

  test('does not release a replacement owner between read and unlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    const store = new WorkflowStore({ projectRoot: join(root, 'project'), sessionId: 'lease-session', baseDirectory: join(root, 'state') })
    await mkdir(store.runDirectory('release-run'), { recursive: true })
    const oldLease = await store.acquireRunLease('release-run', 'old-session')
    const replacement = { ...oldLease, sessionId: 'new-session', token: 'new-owner-token', heartbeatAt: new Date().toISOString() }
    const lock = await acquireFileLease(workflowLeaseLockResource(store.leasePath('release-run')))
    let unblock!: () => void
    const mutation = new Promise<void>(resolve => { unblock = resolve })
    const originalUnlink = fs.unlink
    const unlinkSpy = spyOn(fs, 'unlink').mockImplementation(async path => {
      if (path === store.leasePath('release-run')) await mutation
      return originalUnlink(path)
    })
    try {
      const pending = store.releaseRunLease(oldLease)
      await Bun.sleep(25)
      await writeFile(store.leasePath('release-run'), JSON.stringify(replacement))
      await lock.release()
      unblock()
      await pending
      expect(JSON.parse(await readFile(store.leasePath('release-run'), 'utf8')).token).toBe('new-owner-token')
    } finally {
      unblock()
      unlinkSpy.mockRestore()
      await lock.release().catch(() => undefined)
    }
  })

  test('creates a lease for a live run and removes it after cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-lifecycle-'))
    roots.push(root)
    let manager!: WorkflowManager
    const handle = await (manager = new WorkflowManager({
      sessionId: 'lease-session', projectRoot: join(root, 'project'), baseDirectory: join(root, 'state'),
      providerConfig: { provider: 'deepseek' }, agentRunner: async request => ({ value: request.prompt }),
    })).start({ script: 'export const meta = {"name":"lease"}; await new Promise(() => {});' })
    const leasePath = join(root, 'state', handle.runId, 'lease.json')
    expect(JSON.parse(await readFile(leasePath, 'utf8'))).toMatchObject({ runId: handle.runId, sessionId: 'lease-session' })

    expect(await manager.cancel(handle.runId)).toBe(true)
    await handle.result
    await expect(readFile(leasePath, 'utf8')).rejects.toThrow()
    expect(await manager.listActiveRuns()).toEqual([])
    expect(await manager.listActivityRuns()).toEqual([expect.objectContaining({ runId: handle.runId, status: 'cancelled' })])
  })
})
