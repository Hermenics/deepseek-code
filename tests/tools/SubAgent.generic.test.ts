import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OrchestratorSession } from '../../src/orchestration/index.js'
import type { TaskHandle, ToolExecutionContext } from '../../src/orchestration/types.js'
import { SubAgent, spawnSubAgentTask } from '../../src/tools/SubAgent/SubAgent.js'

/**
 * Unknown agent name that can never resolve: not a builtin (coder/reviewer/tester),
 * not a user/project config (no dirs exist in CI, and a bogus name avoids any
 * machine-local ~/.deepseek/agents/*.json flakiness).
 */
const UNKNOWN_AGENT = 'no-such-agent-8f3a'

/**
 * provider: 'local' pointed at port 1 (never listening) makes the async subagent
 * loop fail fast with ECONNREFUSED instead of touching the network or a real
 * provider — hermetic and deterministic. Retries are disabled so the failure is
 * terminal within milliseconds.
 */
function createSession(projectRoot?: string): OrchestratorSession {
  return new OrchestratorSession({
    projectRoot,
    providerConfig: { provider: 'local', localBaseUrl: 'http://127.0.0.1:1/v1' },
    settings: { agents: {} },
    limits: { maxRetries: 0, retryBackoffMs: 0, timeoutMs: 10_000 },
    logFile: null,
  })
}

function context(session: OrchestratorSession): ToolExecutionContext {
  return session.toolContext({})
}

const handles: Array<TaskHandle<unknown>> = []
const roots: string[] = []

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.cancel('test cleanup')
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
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
    const root = await createGitRepo()
    const session = createSession(root)
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
      { task: 'Summarize the codebase', agent: UNKNOWN_AGENT, role: 'reader', mode: 'background' },
      context(session),
    )
    const parsed = JSON.parse(output) as { taskId?: string; agent?: string }

    expect(parsed.taskId).toBeTruthy()
    expect(parsed.agent).toBe('Agent1')
    expect(output).toContain('generic')
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

    // The generic fallback is only for unresolvable names — a config that
    // resolves (here: usage 'primary', not 'subagent'/'both') must still throw.
    await expect(
      spawnSubAgentTask({ task: 'do work', agent: 'primary-only', role: 'reader' }, context(session)),
    ).rejects.toThrow('not enabled for subagent use')
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
