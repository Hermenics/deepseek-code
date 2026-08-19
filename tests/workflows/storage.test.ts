import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkflowApprovalStore, WorkflowStore, hashWorkflowValue } from '../../src/workflows/storage.js'
import type { WorkflowRun } from '../../src/workflows/types.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

function run(projectRoot: string): WorkflowRun {
  return {
    runId: 'run-1', sessionId: 'session-1', projectRoot,
    meta: { name: 'stored' }, status: 'queued', scriptHash: 'script', argsHash: 'args', optionsHash: 'options', options: {},
    createdAt: new Date().toISOString(), usage: { agents: 0, tokens: 0, costUsd: 0 }, failures: [], worktrees: [],
  }
}

describe('workflow storage', () => {
  test('writes and restores a run atomically with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-store-'))
    roots.push(root)
    const project = join(root, 'project')
    const store = new WorkflowStore({ projectRoot: project, sessionId: 'session-1', baseDirectory: join(root, 'state') })
    const record = run(project)
    await store.createRun(record, 'return 1', { answer: 42 })
    record.status = 'completed'
    record.result = 1
    await store.writeRun(record)

    expect((await store.readRun('run-1'))?.result).toBe(1)
    expect(await store.readArgs('run-1')).toEqual({ answer: 42 })
    if (process.platform !== 'win32') {
      expect((await stat(store.runDirectory('run-1'))).mode & 0o077).toBe(0)
      expect((await stat(join(store.runDirectory('run-1'), 'run.json'))).mode & 0o077).toBe(0)
    }
  })

  test('stores approvals by project and content hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-approval-'))
    roots.push(root)
    const file = join(root, 'approvals.json')
    const approvals = new WorkflowApprovalStore('/project/a', file)
    const hash = hashWorkflowValue('script')
    expect(await approvals.isApproved(hash)).toBe(false)
    await approvals.approve(hash)
    expect(await approvals.isApproved(hash)).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toBeTruthy()
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  test('preserves concurrent approvals in the shared file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-approval-'))
    roots.push(root)
    const file = join(root, 'approvals.json')
    const first = new WorkflowApprovalStore('/project/a', file)
    const second = new WorkflowApprovalStore('/project/b', file)
    await Promise.all([first.approve('hash-a'), second.approve('hash-b')])
    expect(await first.isApproved('hash-a')).toBe(true)
    expect(await second.isApproved('hash-b')).toBe(true)
  })
})
