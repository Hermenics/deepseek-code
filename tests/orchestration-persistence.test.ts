import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestratorSession, TaskSnapshotStore } from '../src/orchestration/index.js'
import { Agent } from '../src/agent/agent.js'
import { captureWorkspaceVersion } from '../src/agent/workspaceVersion.js'

const roots: string[] = []
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// Observe the actual prompt's initial system message.
function systemMessage(agent: Agent): string {
  return String(agent.getMessages()[0]?.content ?? '')
}

function conversationContent(agent: Agent): string {
  return agent.getMessages().map(message => String(message.content ?? '')).join('\n')
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
  it('keeps interrupted work failed after runner reattachment until effects are reconciled', async () => {
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
    let replayed = false
    restored.registry.attachRunner('worker', async () => { replayed = true; return 'must not replay' })
    expect(() => restored.registry.resume('worker')).toThrow('reconcile effects')
    expect(restored.registry.getResult('worker')?.status).toBe('failed')
    expect(replayed).toBe(false)
    pending.cancel()
  })

  it('persists a possible-effect marker so restored work cannot be blindly resumed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-effect-marker-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const original = new OrchestratorSession({ sessionId: 'effect-marker', projectRoot: root, snapshotFile, logFile: null })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    let sideEffectStarted = false
    const pending = original.spawn({ taskId: 'worker', effectPolicy: 'tool-gated' }, async context => {
      const effectId = await context.markEffectStarted('web_fetch')
      const markerSnapshot = await TaskSnapshotStore.read(snapshotFile)
      expect(markerSnapshot.tasks.find(task => task.taskId === 'worker')?.effectLedger).toMatchObject([
        { attempt: 1, tool: 'web_fetch', state: 'unknown' },
      ])
      sideEffectStarted = true
      await context.markEffectOutcome(effectId, 'effect-observed', 'web-fetch-result:fixture-observed')
      const outcomeSnapshot = await TaskSnapshotStore.read(snapshotFile)
      expect(outcomeSnapshot.tasks.find(task => task.taskId === 'worker')?.effectLedger).toMatchObject([
        { attempt: 1, tool: 'web_fetch', state: 'effect-observed', evidence: 'web-fetch-result:fixture-observed' },
      ])
      await waiting
      return 'late result'
    })
    await waitFor(() => sideEffectStarted || pending.status().state === 'failed')
    expect(sideEffectStarted).toBe(true)
    await waitFor(() => pending.status().effectMayHaveStarted === true)
    await original.flush()

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    expect(restored.registry.getStatus('worker').effectMayHaveStarted).toBe(true)
    expect(() => restored.registry.resume('worker')).toThrow('reconcile effects')

    pending.cancel()
    release()
    await original.registry.awaitIdle()
  })

  it('does not treat a no-op snapshot callback as durable effect evidence', async () => {
    const session = new OrchestratorSession({ sessionId: 'no-effect-without-snapshot', projectRoot: process.cwd(), snapshotFile: null, logFile: null })
    const task = session.spawn({ taskId: 'no-effect-without-snapshot', maxRetries: 0, effectPolicy: 'tool-gated' }, async context => {
      const effectId = await context.markEffectStarted('git')
      await context.markEffectOutcome(effectId, 'no-effect', `git-local-state-unchanged:${'d'.repeat(64)}`)
      return 'must not be accepted as durable'
    })

    const result = await task.awaitResult()

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('EFFECT_EVIDENCE_NOT_DURABLE')
    expect(task.status().effectMayHaveStarted).toBe(true)
    expect(task.status().effectLedger?.[0]?.state).toBe('unknown')
    await session.shutdown('completed no-snapshot effect regression')
  })

  it('persists user reconciliation and permits only the reviewed interrupted attempt to resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-effect-reconciliation-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const original = new OrchestratorSession({ sessionId: 'effect-reconciliation', projectRoot: root, snapshotFile, logFile: null })
    const pending = original.spawn({ taskId: 'worker', maxRetries: 1, effectPolicy: 'tool-gated' }, async context => {
      await context.markEffectStarted('write_file')
      throw new Error('connection ended after the effect gate')
    })
    await pending.awaitResult()
    await original.registry.awaitIdle()
    await original.registry.reconcileEffects('worker', 'no-effect', 'I inspected the target and confirmed the write did not happen.')
    await original.flush()

    const saved = await TaskSnapshotStore.read(snapshotFile)
    expect(saved.tasks.find(task => task.taskId === 'worker')?.effectReconciliations).toMatchObject([
      { attempt: 1, resolution: 'no-effect', actor: 'user' },
    ])
    let resumed = 0
    const restored = await OrchestratorSession.restore({
      projectRoot: root, snapshotFile, logFile: null,
      runnerResolver: () => async context => {
        resumed++
        await context.markEffectStarted('write_file')
        return 'freshly authorized retry'
      },
    })
    expect(restored.registry.resume('worker')).toBe(true)
    expect((await restored.registry.awaitResult('worker')).value).toBe('freshly authorized retry')
    expect(resumed).toBe(1)
    await restored.flush()
  })

  it('persists partial effects and artifact metadata before an interrupted task is restored', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-partial-'))
    roots.push(root)
    const snapshotFile = join(root, 'session.json')
    const original = new OrchestratorSession({ sessionId: 'partial-effects', projectRoot: root, snapshotFile, logFile: null })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const pending = original.spawn({ taskId: 'worker' }, async context => {
      context.setPartial({ state: 'running', effect: 'file-write', outputId: 'output-3' })
      context.recordArtifact({ id: 'output-3', kind: 'log', metadata: { source: 'shell' } })
      await waiting
      return 'late result'
    })
    await waitFor(() => pending.status().artifacts?.length === 1)
    await original.flush()

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    expect(restored.registry.getResult('worker')).toMatchObject({
      status: 'failed',
      partial: { state: 'running', effect: 'file-write', outputId: 'output-3' },
      artifacts: [{ id: 'output-3', kind: 'log', metadata: { source: 'shell' } }],
    })
    expect(restored.registry.getStatus('worker').artifactRefs).toContain('output-3')

    pending.cancel()
    release()
    await original.registry.awaitIdle()
  })

  it('reconciles a pending Shell workspace observation when restoring interrupted work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-mas-workspace-reconcile-'))
    roots.push(root)
    const snapshotDirectory = join(root, '.deepseek')
    await mkdir(snapshotDirectory, { recursive: true })
    const snapshotFile = join(snapshotDirectory, 'session.json')
    const original = new OrchestratorSession({ sessionId: 'shell-reconcile', projectRoot: root, snapshotFile, logFile: null })
    const baseline = await captureWorkspaceVersion(root)
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const pending = original.spawn({ taskId: 'shell', type: 'shell' }, async context => {
      context.setPartial({
        schema: 'shell_execution_v1', state: 'running', exitCode: null, signal: null, effects: 'not-reconciled',
        workspaceObservation: {
          schema: 'shell_workspace_observation_v1', scope: 'workspace-source-inputs', status: 'pending',
          cwdRelative: '', baselineDigest: baseline.digest, capturedAt: new Date().toISOString(), processGroupSettled: 'unknown',
        },
        outputChars: 0, outputTruncated: false, drainTimedOut: false,
      })
      await waiting
      return 'late result'
    })
    await waitFor(() => pending.status().state === 'running' && Boolean(pending.status().partial))
    await original.flush()
    await writeFile(join(root, 'changed-after-snapshot.txt'), 'changed')

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    const partial = restored.registry.getResult('shell')?.partial as {
      effects: string
      workspaceObservation: { status: string; baselineDigest: string; observedDigest?: string; processGroupSettled: string }
    }
    expect(partial.effects).toBe('not-reconciled')
    expect(partial.workspaceObservation.status).toBe('changed')
    expect(partial.workspaceObservation.observedDigest).not.toBe(partial.workspaceObservation.baselineDigest)
    expect(partial.workspaceObservation.processGroupSettled).toBe('unknown')

    pending.cancel()
    release()
    await original.registry.awaitIdle()
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
      expect(systemMessage(agent)).not.toContain('FIRST_ROOT_ONLY')
      expect(conversationContent(agent)).toContain('FIRST_ROOT_ONLY')
      await agent.applyAgentConfig({ name: 'root-agent', systemPrompt: 'FIRST_AGENT_PROMPT', files: ['context.md'] })
      expect(systemMessage(agent)).toContain('FIRST_CONTEXT')
      await agent.setWorkingDirectory(secondRoot)
      expect(conversationContent(agent)).not.toContain('SECOND_AGENT_PROMPT')
      expect(conversationContent(agent)).not.toContain('SECOND_CONTEXT')
      expect(conversationContent(agent)).not.toContain('FIRST_ROOT_ONLY')
      expect(conversationContent(agent)).not.toContain('FIRST_CONTEXT')
    } finally {
      await agent.shutdown()
    }
  })
})
