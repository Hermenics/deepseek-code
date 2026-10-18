import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OrchestratorSession } from '../../src/orchestration/index.js'
import type { TaskHandle, TaskResultEnvelopeV1, ToolExecutionContext } from '../../src/orchestration/types.js'
import type { DeepSeekSettings } from '../../src/settings/types.js'
import { SubAgent, spawnSubAgentTask } from '../../src/tools/SubAgent/SubAgent.js'
import { normalizeToolException } from '../../src/tools/result.js'
import { hookAuditLog } from '../../src/hooks/executor.js'
import { printOutput } from '../platform-commands.js'

/**
 * Unknown agent name that can never resolve: not a builtin (coder/reviewer/tester),
 * not a user/project config; each default test session uses a fresh empty root.
 */
const UNKNOWN_AGENT = 'no-such-agent-8f3a'

/**
 * provider: 'local' pointed at port 1 (never listening) makes the async subagent
 * loop fail fast with ECONNREFUSED instead of touching the network or a real
 * provider — hermetic and deterministic. Retries are disabled so the failure is
 * terminal within milliseconds.
 */
function createSession(projectRoot?: string, settings: DeepSeekSettings = { agents: {} }): OrchestratorSession {
  const root = projectRoot ?? mkdtempSync(join(tmpdir(), 'dsk-generic-project-'))
  if (!projectRoot) roots.push(root)
  const session = new OrchestratorSession({
    projectRoot: root,
    providerConfig: { provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1' },
    settings,
    limits: { maxRetries: 0, retryBackoffMs: 0, timeoutMs: 10_000 },
    logFile: null,
  })
  sessions.push(session)
  return session
}

function context(session: OrchestratorSession, signal?: AbortSignal): ToolExecutionContext {
  return session.toolContext({ signal })
}

const handles: Array<TaskHandle<unknown>> = []
const roots: string[] = []
const sessions: OrchestratorSession[] = []

afterEach(async () => {
  const activeHandles = handles.splice(0)
  for (const handle of activeHandles) handle.cancel('test cleanup')
  await Promise.allSettled(activeHandles.map(handle => handle.awaitResult()))
  await Promise.all(sessions.splice(0).map(session => session.registry.awaitIdle()))
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

async function spawnGeneric(session: OrchestratorSession, task = 'Search the repository for TODO comments'): Promise<{ handle: TaskHandle<unknown>; agentName?: string }> {
  const spawned = await spawnSubAgentTask({ task, role: 'reader' }, context(session))
  handles.push(spawned.handle)
  return spawned
}

async function createGitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsk-generic-'))
  roots.push(root)
  await execa('git', ['init', '-q'], { cwd: root })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'file.txt'), 'base\n')
  await execa('git', ['add', '--', 'file.txt'], { cwd: root })
  await execa('git', ['commit', '-qm', 'base'], { cwd: root })
  return root
}

describe('SubAgent generic spawn fallback', () => {
  it('does not run SubagentStart hooks or create a task after parent cancellation', async () => {
    const session = createSession(undefined, {
      agents: {},
      hooks: { SubagentStart: [{ matcher: 'Agent1', hooks: [{ type: 'command', command: printOutput('hook ran') }] }] },
    })
    const controller = new AbortController()
    controller.abort(new Error('parent cancelled'))
    hookAuditLog.length = 0

    await expect(spawnSubAgentTask({ task: 'Search the repository', role: 'reader' }, context(session, controller.signal)))
      .rejects.toThrow('parent cancelled')

    expect(hookAuditLog).toHaveLength(0)
    expect(session.registry.listTasks()).toHaveLength(0)
  })

  it('falls back to a generic subagent instead of throwing when the agent name is unknown', async () => {
    const session = createSession()
    const spawned = await spawnSubAgentTask({ task: 'Search the repository', agent: UNKNOWN_AGENT, role: 'reader' }, context(session))
    handles.push(spawned.handle)

    expect(spawned.handle.taskId).toBeTruthy()
    expect(spawned.agentName).toBe('Agent1')
  })

  it('assigns sequential AgentN names to consecutive generic spawns in the same session', async () => {
    const session = createSession()
    const first = await spawnGeneric(session)
    const second = await spawnGeneric(session)

    expect(first.agentName).toBe('Agent1')
    expect(second.agentName).toBe('Agent2')
  })

  it('shares a single AgentN counter between the no-agent and unknown-agent spawn paths', async () => {
    const session = createSession()
    const noAgent = await spawnSubAgentTask({ task: 'Summarize the codebase', role: 'reader' }, context(session))
    handles.push(noAgent.handle)
    const unknownAgent = await spawnSubAgentTask({ task: 'Summarize the codebase', agent: UNKNOWN_AGENT, role: 'reader' }, context(session))
    handles.push(unknownAgent.handle)

    expect(noAgent.agentName).toBe('Agent1')
    expect(unknownAgent.agentName).toBe('Agent2')
  })

  it('preserves the fixed agent name and does not advance the generic counter', async () => {
    const session = createSession()
    const fixed = await spawnSubAgentTask({ task: 'Fix the bug in file.txt', agent: 'coder' }, context(session))
    handles.push(fixed.handle)

    expect(fixed.agentName).toBe('coder')

    const generic = await spawnGeneric(session)
    expect(generic.agentName).toBe('Agent1')
  })

  it('restarts the AgentN sequence for a new session', async () => {
    const firstSession = createSession()
    const first = await spawnGeneric(firstSession)
    expect(first.agentName).toBe('Agent1')

    const secondSession = createSession()
    expect(secondSession.sessionId).not.toBe(firstSession.sessionId)
    const again = await spawnGeneric(secondSession)
    expect(again.agentName).toBe('Agent1')
  })

  it('advances the counter past a terminal agent without resetting, even on runtime failure', async () => {
    const session = createSession()
    const first = await spawnGeneric(session)
    expect(first.agentName).toBe('Agent1')

    const result = await first.handle.awaitResult()
    // The hermetic session points at a never-listening provider (127.0.0.1:1),
    // so the agent deterministically fails at runtime — the counter must still
    // advance. Names are allocated at spawn time, before the runner executes.
    expect(['failed', 'error']).toContain(result.status)

    const second = await spawnGeneric(session)
    expect(second.agentName).toBe('Agent2')
  })

  it('surfaces the AgentN name through the session start callback consumed by the UI tracker', async () => {
    const session = createSession()
    const started: Array<{ id: string; agentName?: string }> = []
    session.setCallbacks({ onStart: (id, _task, agentName) => started.push({ id, agentName }) })

    const spawned = await spawnSubAgentTask({ task: 'Summarize the codebase', agent: UNKNOWN_AGENT, role: 'reader' }, context(session))
    handles.push(spawned.handle)
    await spawned.handle.awaitResult()

    expect(started.find(entry => entry.id === spawned.handle.taskId)?.agentName).toBe('Agent1')
  })

  it('returns a generic-fallback note in the background tool result when the agent name is unknown', async () => {
    const session = createSession()
    const output = await SubAgent.execute(
      { task: 'Summarize the codebase', agent: UNKNOWN_AGENT, mode: 'background' },
      context(session),
    )
    const parsed = JSON.parse(output) as {
      taskId?: string
      agent?: string
      effectiveScope?: { mode: string; role: string; permissionProfile: string; contextMode: string; timeoutMs: number }
    }

    expect(parsed.taskId).toBeTruthy()
    expect(parsed.agent).toBe('Agent1')
    expect(parsed.effectiveScope).toEqual({
      mode: 'background', role: 'reader', permissionProfile: 'researcher-readonly', contextMode: 'fresh', timeoutMs: 120_000,
    })
    expect(output).toContain('generic')
  })

  it('reports a primary background effect only after its durable task subtree settles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-primary-background-subagent-'))
    roots.push(root)
    const session = new OrchestratorSession({
      projectRoot: root,
      providerConfig: { provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1' },
      settings: { agents: {} },
      snapshotFile: join(root, 'tasks.json'),
      logFile: null,
      limits: { maxRetries: 0, retryBackoffMs: 0, timeoutMs: 10_000 },
    })
    sessions.push(session)
    const spawn = session.spawn.bind(session)
    let releaseTask!: () => void
    let taskStarted!: () => void
    const taskGate = new Promise<void>(resolve => { releaseTask = resolve })
    const started = new Promise<void>(resolve => { taskStarted = resolve })
    session.spawn = ((input: Parameters<typeof session.spawn>[0], runner: Parameters<typeof session.spawn>[1]) => {
      if (input.metadata?.origin !== 'subagent') return spawn(input, runner)
      return spawn(input, async taskContext => {
        const effectId = await taskContext.markEffectStarted('write_file')
        taskStarted()
        await taskGate
        await taskContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'b'.repeat(64)}`)
        return { summary: 'completed', confidence: 1, filesRead: [], filesChanged: ['result.txt'], issuesFound: [], suggestions: [], metadata: {} }
      })
    }) as typeof session.spawn

    const primaryCallId = 'stable-primary-background-call'
    let reportOutcome!: (value: { effectId: string; state: string; evidence: string }) => void
    const outcome = new Promise<{ effectId: string; state: string; evidence: string }>(resolve => { reportOutcome = resolve })
    const toolContext = context(session)
    toolContext.effectId = primaryCallId
    toolContext.markEffectOutcome = async (effectId, state, evidence) => reportOutcome({ effectId, state, evidence })

    const output = await SubAgent.execute({ task: 'Perform a bounded task', mode: 'background' }, toolContext)
    const handle = JSON.parse(output) as { taskId: string }
    await started
    expect(session.registry.getStatus(handle.taskId).metadata.primaryEffectId).toBe(primaryCallId)
    releaseTask()

    const report = await outcome
    expect(report.effectId).toBe(primaryCallId)
    expect(report.state).toBe('effect-observed')
    expect(JSON.parse(report.evidence)).toMatchObject({
      schema: 'primary_subagent_background_outcome_v1',
      taskId: handle.taskId,
      evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/),
    })
  })

  it('exposes effective foreground defaults when spawning without optional scope arguments', async () => {
    const session = createSession()
    const spawned = await spawnSubAgentTask({ task: 'Summarize the codebase' }, context(session))
    handles.push(spawned.handle)

    expect(spawned.effectiveScope).toEqual({
      mode: 'foreground', role: 'reader', permissionProfile: 'researcher-readonly', contextMode: 'fresh', timeoutMs: 120_000,
    })
  })

  it('includes the effective default scope when a foreground subagent fails', async () => {
    const session = createSession()
    await expect(SubAgent.execute({ task: 'Summarize the codebase' }, context(session))).rejects.toThrow(
      'Effective delegation scope: {"mode":"foreground","role":"reader","permissionProfile":"researcher-readonly","contextMode":"fresh","timeoutMs":120000}',
    )
  })

  it('preserves a failed task envelope through the foreground tool error boundary', async () => {
    const session = createSession()
    const taskResult: TaskResultEnvelopeV1 = {
      schemaVersion: 1,
      taskId: 'failed-subagent',
      sessionId: session.sessionId,
      status: 'failed',
      partial: { completedFiles: ['README.md'], artifactRefs: ['existing-artifact'] },
      artifacts: [{ id: 'recovery-artifact', kind: 'log' }],
      metrics: { usageAvailable: true },
      error: { code: 'REMOTE_WORKER_FAILED', message: 'worker unavailable', retryable: true },
      completedAt: new Date(0).toISOString(),
    }
    const handle = { awaitResult: async () => taskResult } as TaskHandle<unknown>
    session.spawn = (() => handle) as typeof session.spawn

    const thrown = await SubAgent.execute({ task: 'Inspect the repository' }, context(session)).catch(error => error)
    const normalized = JSON.parse(normalizeToolException(thrown)) as {
      status: string
      error: { code: string; retryable: boolean }
      partial: { completedFiles: string[]; artifactRefs: string[] }
    }

    expect(normalized).toMatchObject({
      status: 'partial',
      error: { code: 'REMOTE_WORKER_FAILED', retryable: true },
      partial: { completedFiles: ['README.md'], artifactRefs: ['existing-artifact', 'recovery-artifact'] },
    })
  })

  it('records a linked foreground subagent effect only from a durable descendant receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-subagent-effects-'))
    roots.push(root)
    const session = new OrchestratorSession({
      projectRoot: root,
      providerConfig: { provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1' },
      settings: { agents: {} },
      snapshotFile: join(root, 'tasks.json'),
      logFile: null,
      limits: { maxRetries: 0, retryBackoffMs: 0, timeoutMs: 10_000 },
    })
    sessions.push(session)
    const spawn = session.spawn.bind(session)
    session.spawn = ((input: Parameters<typeof session.spawn>[0], runner: Parameters<typeof session.spawn>[1]) => {
      if (!input.parentTaskId) return spawn(input, runner)
      return spawn(input, async childContext => {
        const childEffectId = await childContext.markEffectStarted('write_file')
        await childContext.markEffectOutcome(childEffectId, 'effect-observed', `file-sha256:${'a'.repeat(64)}`)
        return { summary: 'completed', confidence: 1, filesRead: [], filesChanged: ['result.txt'], issuesFound: [], suggestions: [], metadata: {} }
      })
    }) as typeof session.spawn

    const parent = spawn({
      taskId: 'effect-parent', effectPolicy: 'tool-gated', allowDelegation: true, maxDepth: 2, maxFanOut: 2,
      maxRetries: 0, permissionProfile: 'coordinator-integrator',
    }, async parentContext => {
      const effectId = await parentContext.markEffectStarted('subagent')
      const toolContext = session.toolContext({
        taskId: parentContext.taskId,
        markEffectStarted: parentContext.markEffectStarted,
        markEffectOutcome: parentContext.markEffectOutcome,
        permissionProfile: 'coordinator-integrator',
      })
      toolContext.effectId = effectId
      await SubAgent.execute({ task: 'Perform a bounded child task', role: 'reader' }, toolContext)
      return 'completed'
    })
    handles.push(parent)

    const result = await parent.awaitResult()
    const record = session.registry.getStatus(parent.taskId)
    const child = session.registry.listTasks({ parentTaskId: parent.taskId })[0]!
    expect(result.status).toBe('done')
    expect(child.parentEffectId).toBe(record.effectLedger?.[0]?.id)
    expect(child.parentEffectAttempt).toBe(1)
    expect(record.effectLedger).toMatchObject([{ tool: 'subagent', state: 'effect-observed', evidence: expect.stringMatching(/^descendant-effects-sha256:[a-f0-9]{64}$/) }])
  })

  it('leaves the parent effect unknown when a completed child has no durable positive receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-subagent-no-effect-'))
    roots.push(root)
    const session = new OrchestratorSession({
      projectRoot: root,
      providerConfig: { provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1' },
      settings: { agents: {} },
      snapshotFile: join(root, 'tasks.json'),
      logFile: null,
      limits: { maxRetries: 0, retryBackoffMs: 0, timeoutMs: 10_000 },
    })
    sessions.push(session)
    const spawn = session.spawn.bind(session)
    session.spawn = ((input: Parameters<typeof session.spawn>[0], runner: Parameters<typeof session.spawn>[1]) => {
      if (!input.parentTaskId) return spawn(input, runner)
      return spawn(input, async () => ({ summary: 'completed', confidence: 1, filesRead: [], filesChanged: [], issuesFound: [], suggestions: [], metadata: {} }))
    }) as typeof session.spawn

    const parent = spawn({
      taskId: 'no-effect-parent', effectPolicy: 'tool-gated', allowDelegation: true, maxDepth: 2, maxFanOut: 2,
      maxRetries: 0, permissionProfile: 'coordinator-integrator',
    }, async parentContext => {
      const effectId = await parentContext.markEffectStarted('subagent')
      const toolContext = session.toolContext({
        taskId: parentContext.taskId,
        markEffectStarted: parentContext.markEffectStarted,
        markEffectOutcome: parentContext.markEffectOutcome,
        permissionProfile: 'coordinator-integrator',
      })
      toolContext.effectId = effectId
      await SubAgent.execute({ task: 'Perform a bounded child task', role: 'reader' }, toolContext)
      return 'completed'
    })
    handles.push(parent)

    const result = await parent.awaitResult()
    expect(result.status).toBe('done')
    expect(session.registry.getStatus(parent.taskId).effectLedger?.[0]).toMatchObject({ tool: 'subagent', state: 'unknown' })
  })

  it('keeps a positive parent receipt unknown when another descendant outcome is unresolved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsk-subagent-partial-effects-'))
    roots.push(root)
    const session = new OrchestratorSession({
      projectRoot: root,
      providerConfig: { provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1' },
      settings: { agents: {} },
      snapshotFile: join(root, 'tasks.json'),
      logFile: null,
      limits: { maxRetries: 0, retryBackoffMs: 0, timeoutMs: 10_000 },
    })
    sessions.push(session)
    const spawn = session.spawn.bind(session)
    session.spawn = ((input: Parameters<typeof session.spawn>[0], runner: Parameters<typeof session.spawn>[1]) => {
      if (!input.parentTaskId) return spawn(input, runner)
      return spawn(input, async childContext => {
        const observed = await childContext.markEffectStarted('write_file')
        await childContext.markEffectOutcome(observed, 'effect-observed', `file-sha256:${'e'.repeat(64)}`)
        await childContext.markEffectStarted('external_database_query')
        return { summary: 'completed', confidence: 1, filesRead: [], filesChanged: ['result.txt'], issuesFound: [], suggestions: [], metadata: {} }
      })
    }) as typeof session.spawn

    const parent = spawn({
      taskId: 'partial-effect-parent', effectPolicy: 'tool-gated', allowDelegation: true, maxDepth: 2, maxFanOut: 2,
      maxRetries: 0, permissionProfile: 'coordinator-integrator',
    }, async parentContext => {
      const effectId = await parentContext.markEffectStarted('subagent')
      const toolContext = session.toolContext({
        taskId: parentContext.taskId,
        markEffectStarted: parentContext.markEffectStarted,
        markEffectOutcome: parentContext.markEffectOutcome,
        permissionProfile: 'coordinator-integrator',
      })
      toolContext.effectId = effectId
      await SubAgent.execute({ task: 'Perform a bounded child task', role: 'reader' }, toolContext)
      return 'completed'
    })
    handles.push(parent)

    const result = await parent.awaitResult()
    const child = session.registry.listTasks({ parentTaskId: parent.taskId })[0]!
    expect(result.status).toBe('done')
    expect(child.effectLedger).toMatchObject([
      { tool: 'write_file', state: 'effect-observed' },
      { tool: 'external_database_query', state: 'unknown' },
    ])
    expect(session.registry.getStatus(parent.taskId).effectLedger?.[0]).toMatchObject({ tool: 'subagent', state: 'unknown' })
  })

  it('keeps numbering beyond nine with no zero-padding (Agent10, Agent11)', async () => {
    const session = createSession()
    const names: Array<string | undefined> = []
    for (let i = 0; i < 11; i += 1) {
      const spawned = await spawnGeneric(session)
      names.push(spawned.agentName)
    }

    expect(names).toEqual([
      'Agent1', 'Agent2', 'Agent3', 'Agent4', 'Agent5', 'Agent6',
      'Agent7', 'Agent8', 'Agent9', 'Agent10', 'Agent11',
    ])
  })

  it('fails loudly for a disabled agent without advancing the generic counter', async () => {
    const root = await createGitRepo()
    const agentDir = join(root, '.deepseek', 'agents')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'disabled-agent.json'), JSON.stringify({
      name: 'disabled-agent', systemPrompt: 'x', enabled: false,
    }))
    const session = createSession(root)

    // A deliberately disabled agent must propagate loudly — never silently
    // become a generic AgentN (the generic fallback is only for unknown names).
    await expect(
      spawnSubAgentTask({ task: 'do work', agent: 'disabled-agent', role: 'reader' }, context(session)),
    ).rejects.toThrow(/is disabled/)

    const generic = await spawnGeneric(session)
    expect(generic.agentName).toBe('Agent1')
  })

  it('still throws for a resolvable agent that is not enabled for subagent use', async () => {
    const root = await createGitRepo()
    const agentDir = join(root, '.deepseek', 'agents')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'primary-only.json'), JSON.stringify({
      name: 'primary-only', usage: 'primary', systemPrompt: 'Coordinates the whole session.',
    }))
    const session = createSession(root)

    // The project config resolves, but it is untrusted until the user approves it.
    await expect(
      spawnSubAgentTask({ task: 'do work', agent: 'primary-only', role: 'reader' }, context(session)),
    ).rejects.toThrow('requires explicit workspace trust')
  })

  it('surfaces a malformed agent config loudly instead of silently spawning a generic agent', async () => {
    const root = await createGitRepo()
    const agentDir = join(root, '.deepseek', 'agents')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'broken-agent.json'), '{invalid')
    const session = createSession(root)

    // Regression: the generic fallback must only swallow the not-found error —
    // a broken config (malformed JSON here) has to propagate loudly again.
    await expect(
      spawnSubAgentTask({ task: 'do work', agent: 'broken-agent', role: 'reader' }, context(session)),
    ).rejects.toThrow(/Invalid agent config .*malformed JSON/)
  })

  it('prefers the config error over the generic fallback for any name in a broken-registry project', async () => {
    const root = await createGitRepo()
    const agentDir = join(root, '.deepseek', 'agents')
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'broken-agent.json'), '{invalid')
    const session = createSession(root)

    // loadAgentRegistry validates every file in every layer before any name
    // lookup, so even a genuinely unknown name cannot resolve to the generic
    // fallback while a config file is broken. Loud error wins — documented
    // decision: the fallback contract only applies to a healthy registry.
    await expect(
      spawnSubAgentTask({ task: 'do work', agent: UNKNOWN_AGENT, role: 'reader' }, context(session)),
    ).rejects.toThrow(/Invalid agent config .*malformed JSON/)
  })
})
