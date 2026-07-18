import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OrchestratorSession } from '../src/orchestration/index.js'

const roots: string[] = []
async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-e2e-'))
  roots.push(root)
  await execa('git', ['init', '-q'], { cwd: root })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'counter.ts'), 'export const increment = (value: number) => value\n')
  await writeFile(join(root, '.gitignore'), '.deepseek/\nevents.jsonl\n')
  await execa('git', ['add', '--', 'counter.ts', '.gitignore'], { cwd: root })
  await execa('git', ['commit', '-qm', 'base'], { cwd: root })
  return root
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('coordinator to verified integration', () => {
  it('runs researchers concurrently, isolates the writer, tests, verifies and audits partial failure', async () => {
    const root = await repository()
    const logFile = join(root, 'events.jsonl')
    const session = new OrchestratorSession({ sessionId: 'e2e', projectRoot: root, logFile, limits: { concurrency: 3, retryBackoffMs: 0 } })
    const coordinator = session.spawn({ taskId: 'coordinator', allowDelegation: true, maxFanOut: 5 }, async () => 'plan accepted')
    await coordinator.awaitResult()

    let activeResearchers = 0
    let peakResearchers = 0
    const researcher = session.spawn({
      taskId: 'researcher', parentTaskId: coordinator.taskId, permissionProfile: 'researcher-readonly', allowDelegation: false,
    }, async context => {
      const lease = await session.acquireWorkspace(context.taskId, 'researcher-readonly', context.signal)
      activeResearchers++; peakResearchers = Math.max(peakResearchers, activeResearchers)
      await new Promise(resolve => setTimeout(resolve, 5))
      const source = await readFile(join(lease.workspace.path, 'counter.ts'), 'utf8')
      activeResearchers--
      return { issue: source.includes('=> value') ? 'increment does not increment' : 'none' }
    })
    const unavailable = session.spawn({
      taskId: 'researcher-failed', parentTaskId: coordinator.taskId, permissionProfile: 'researcher-readonly',
      allowDelegation: false, maxRetries: 0,
    }, async context => {
      activeResearchers++; peakResearchers = Math.max(peakResearchers, activeResearchers)
      context.setPartial({ filesRead: ['counter.ts'], note: 'provider became unavailable' })
      await new Promise(resolve => setTimeout(resolve, 5))
      activeResearchers--
      throw new Error('research provider unavailable')
    })
    expect((await researcher.awaitResult()).status).toBe('done')
    const failedResearch = await unavailable.awaitResult()
    expect(failedResearch.status).toBe('failed')
    expect(failedResearch.partial).toEqual({ filesRead: ['counter.ts'], note: 'provider became unavailable' })
    expect(peakResearchers).toBe(2)

    const writer = session.spawn({
      taskId: 'writer', parentTaskId: coordinator.taskId, dependencies: [researcher.taskId],
      permissionProfile: 'writer-worktree', allowDelegation: false,
    }, async context => {
      const lease = await session.acquireWorkspace(context.taskId, 'writer-worktree', context.signal)
      try {
        expect(lease.workspace.isolation).toBe('git-worktree')
        await writeFile(join(lease.workspace.path, 'counter.ts'), 'export const increment = (value: number) => value + 1\n')
        return { workspace: lease.workspace.path, changed: ['counter.ts'] }
      } finally { await lease.release() }
    })
    expect((await writer.awaitResult()).status).toBe('done')
    const integration = await session.integrateTask(writer.taskId)
    expect(integration.integrated).toBe(true)
    expect(await readFile(join(root, 'counter.ts'), 'utf8')).toContain('value + 1')

    const tester = session.spawn({
      taskId: 'tester', parentTaskId: coordinator.taskId, dependencies: [writer.taskId],
      permissionProfile: 'tester', allowDelegation: false,
    }, async () => ({ passed: (await readFile(join(root, 'counter.ts'), 'utf8')).includes('value + 1') }))
    expect((await tester.awaitResult()).value).toEqual({ passed: true })

    const verifier = session.spawn({
      taskId: 'verifier', parentTaskId: coordinator.taskId, dependencies: [tester.taskId],
      permissionProfile: 'researcher-readonly', contextMode: 'fresh', allowDelegation: false,
    }, async () => ({ classification: 'CONFIRMED', evidence: ['counter.ts contains value + 1'] }))
    expect((await verifier.awaitResult()).value).toEqual({ classification: 'CONFIRMED', evidence: ['counter.ts contains value + 1'] })
    expect(await session.cleanupTaskWorkspace(writer.taskId)).toBe(true)
    expect(session.registry.getStatus(writer.taskId).workspace).toBeUndefined()

    await session.flush()
    const events = (await readFile(logFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(events.some(event => event.type === 'workspace_created' && event.taskId === 'writer')).toBe(true)
    expect(events.some(event => event.type === 'integration' && event.payload.integrated === true)).toBe(true)
    expect(events.some(event => event.type === 'error' && event.taskId === 'researcher-failed')).toBe(true)
    expect(session.registry.listTasks()).toHaveLength(6)
  })
})
