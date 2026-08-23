import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestratorSession, TaskSnapshotStore } from '../src/orchestration/index.js'
import { Agent } from '../src/agent/agent.js'

const roots: string[] = []
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// Observador do prompt real: o system message inicial da conversa
function systemMessage(agent: Agent): string {
  return String(agent.getMessages()[0]?.content ?? '')
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition timed out')
    await tick()
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('orchestrator snapshots', () => {
  it('marks interrupted work failed and resumes after its runner is reattached', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-snapshot-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const original = new OrchestratorSession({ sessionId: 'persisted', projectRoot: root, snapshotFile, logFile: null })
    const pending = original.spawn({ taskId: 'worker', maxRetries: 1 }, ({ signal }) => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    await waitFor(() => pending.status().state === 'running')
    await original.flush()

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    expect(restored.registry.getStatus('worker').state).toBe('failed')
    expect(restored.registry.getStatus('worker').error?.code).toBe('INTERRUPTED')
    restored.registry.attachRunner('worker', async () => 'resumed value')
    expect(restored.registry.resume('worker')).toBe(true)
    expect((await restored.registry.awaitResult('worker')).value).toBe('resumed value')
    pending.cancel()
  })

  it('continues the generic AgentN sequence across snapshot restore', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-counter-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const original = new OrchestratorSession({ sessionId: 'counter', projectRoot: root, snapshotFile, logFile: null })
    await original.spawn({ taskId: 'a1', metadata: { agentName: 'Agent1' } }, async () => 'done').awaitResult()
    await original.spawn({ taskId: 'a2', metadata: { agentName: 'Agent2' } }, async () => 'done').awaitResult()
    await original.flush()

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    expect(restored.nextGenericAgentName()).toBe('Agent3')

    const fresh = new OrchestratorSession({ sessionId: 'counter', projectRoot: root, snapshotFile, logFile: null })
    expect(await fresh.restorePersisted()).toBe(true)
    expect(fresh.nextGenericAgentName()).toBe('Agent3')
  })

  it('persists mailbox state with secret redaction and validates the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-snapshot-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const session = new OrchestratorSession({ sessionId: 'mailbox', projectRoot: root, snapshotFile, logFile: null })
    const task = session.spawn({ taskId: 'mail' }, async () => 'done')
    task.sendMessage('permission', { authorization: 'Bearer super-secret-value', tokens: 42 }, undefined, 'permission-1')
    await task.awaitResult()
    await session.flush()
    expect(await readFile(snapshotFile, 'utf8')).not.toContain('super-secret-value')
    const snapshot = await TaskSnapshotStore.read(snapshotFile)
    expect(snapshot.messages[0]?.payload.authorization).toBe('[REDACTED]')
    expect(snapshot.messages[0]?.payload.tokens).toBe(42)
    await expect(OrchestratorSession.restore({ projectRoot: join(root, 'other'), snapshotFile, logFile: null })).rejects.toThrow('projectRoot')
  })

  it('captures save input synchronously and persists acknowledgements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-snapshot-'))
    roots.push(root)
    const directFile = join(root, 'direct.json')
    const messages: any[] = []
    const store = new TaskSnapshotStore(directFile)
    store.save('captured', root, [], messages)
    messages.push({ secret: 'late mutation' })
    await store.flush()
    expect((await TaskSnapshotStore.read(directFile)).messages).toEqual([])

    const snapshotFile = join(root, 'session.json')
    const session = new OrchestratorSession({ sessionId: 'ack', projectRoot: root, snapshotFile, logFile: null })
    const task = session.spawn({ taskId: 'mail' }, async () => 'done')
    const message = task.sendMessage('question', { text: 'answer me' })
    expect(session.registry.acknowledgeMessage(message.messageId)).toBe(true)
    await task.awaitResult()
    await session.flush()
    expect((await TaskSnapshotStore.read(snapshotFile)).messages[0]?.status).toBe('processed')
  })

  it('rejects tampered task identities, profiles, envelopes and workspace paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-snapshot-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const session = new OrchestratorSession({ sessionId: 'tamper', projectRoot: root, snapshotFile, logFile: null })
    await session.spawn({ taskId: 'task' }, async () => 'trusted').awaitResult()
    await session.flush()
    const original = JSON.parse(await readFile(snapshotFile, 'utf8'))
    await session.shutdown()
    for (const [name, mutate] of [
      ['profile', (value: any) => { value.tasks[0].permissionProfile = 'root' }],
      ['result identity', (value: any) => { value.tasks[0].result.taskId = 'other' }],
      ['workspace path', (value: any) => { value.tasks[0].workspace = { path: '/tmp/foreign', projectRoot: root, isolation: 'git-worktree' } }],
    ]) {
      const value = structuredClone(original)
      ;(mutate as (value: any) => void)(value)
      await writeFile(snapshotFile, JSON.stringify(value))
      try {
        await TaskSnapshotStore.read(snapshotFile)
        throw new Error(`tampered ${name} snapshot was accepted`)
      } catch (error) {
        expect((error as Error).message).not.toBe(`tampered ${name} snapshot was accepted`)
      }
    }
  })

  it('restores workspace ownership and is wired into the production Agent lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-snapshot-'))
    roots.push(root)
    const snapshotFile = join(root, 'agent-tasks.json')
    const first = new Agent({ provider: 'local', localModel: 'fake' }, { sessionId: 'agent-persisted', projectRoot: root, snapshotFile, logFile: null })
    await first.readyPromise
    const task = first.orchestrator.spawn({ taskId: 'owned' }, async context => {
      const lease = await first.orchestrator.acquireWorkspace(context.taskId, 'writer-worktree', context.signal)
      await lease.release()
      return 'done'
    })
    await task.awaitResult()
    await first.orchestrator.flush()

    const restored = new Agent({ provider: 'local', localModel: 'fake' }, { sessionId: 'agent-persisted', projectRoot: root, snapshotFile, logFile: null })
    await restored.readyPromise
    expect(restored.orchestrator.registry.getResult('owned')?.value).toBe('done')
    expect(restored.orchestrator.workspaces.get('owned')?.projectRoot).toBe(root)
    await Promise.all([first.shutdown(), restored.shutdown()])
  })

  it('does not reactivate an untrusted project agent after changing roots', async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), 'deepseek-agent-root-'))
    const secondRoot = await mkdtemp(join(tmpdir(), 'deepseek-agent-root-'))
    roots.push(firstRoot, secondRoot)
    await writeFile(join(firstRoot, 'DEEPSEEK.md'), 'FIRST_ROOT_ONLY')
    await writeFile(join(secondRoot, 'DEEPSEEK.md'), 'SECOND_ROOT_ONLY')
    await writeFile(join(firstRoot, 'context.md'), 'FIRST_CONTEXT')
    await writeFile(join(secondRoot, 'context.md'), 'SECOND_CONTEXT')
    await mkdir(join(secondRoot, '.deepseek', 'agents'), { recursive: true })
    await writeFile(join(secondRoot, '.deepseek', 'agents', 'root-agent.json'), JSON.stringify({
      name: 'root-agent', systemPrompt: 'SECOND_AGENT_PROMPT', files: ['context.md'],
    }))
    const agent = new Agent({ provider: 'local', localModel: 'fake' }, { projectRoot: firstRoot, snapshotFile: null, logFile: null })
    try {
      await agent.readyPromise
      expect(systemMessage(agent)).toContain('FIRST_ROOT_ONLY')
      await agent.applyAgentConfig({ name: 'root-agent', systemPrompt: 'FIRST_AGENT_PROMPT', files: ['context.md'] })
      expect(systemMessage(agent)).toContain('FIRST_CONTEXT')
      await agent.setWorkingDirectory(secondRoot)
      expect(systemMessage(agent)).not.toContain('SECOND_AGENT_PROMPT')
      expect(systemMessage(agent)).not.toContain('SECOND_CONTEXT')
      expect(systemMessage(agent)).not.toContain('FIRST_ROOT_ONLY')
      expect(systemMessage(agent)).not.toContain('FIRST_CONTEXT')
    } finally {
      await agent.shutdown()
    }
  })
})
