import { expect, test } from 'bun:test'
import { mkdtemp, rm, access } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  countActiveActivities,
  hasActivityToOpen,
  canMessageSubagent,
  canControlWorkflowRun,
  buildSubagentStatusLineInput,
  createSubagentStatusLineScheduler,
  parseSubagentStatusLineOutput,
  resolveActivityFocus,
  runWorkflowFooterAction,
  runSubagentStatusLine,
  SUBAGENT_STATUS_LINE_MAX_OUTPUT_BYTES,
  getTrustedUserStatusLineConfig,
  statusLineTrustFromEffectiveSettings,
  validateSubagentStatusLineConfig,
  type ActivityFocusSelection,
} from '../../src/ui/App.js'
import type { SubagentState } from '../../src/ui/subagent/types.js'
import type { WorkflowRun } from '../../src/workflows/types.js'

function agent(overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id: 'agent-1',
    task: 'inspect the project',
    status: 'running',
    colorIndex: 0,
    toolCount: 0,
    lastToolInfo: null,
    startedAt: Date.now(),
    durationMs: null,
    result: null,
    error: null,
    tokens: null,
    costUsd: null,
    role: null,
    confidence: null,
    verified: null,
    agentName: null,
    ...overrides,
  }
}

function workflow(status: WorkflowRun['status']): WorkflowRun {
  return {
    runId: `run-${status}`,
    sessionId: 'session',
    projectRoot: '/project',
    meta: { name: 'audit' },
    status,
    scriptHash: 'script',
    argsHash: 'args',
    optionsHash: 'options',
    options: {},
    createdAt: new Date().toISOString(),
    usage: { agents: 0, tokens: 0, costUsd: 0 },
    failures: [],
    worktrees: [],
  }
}

test('activity count contains only standalone live agents and live workflows', () => {
  expect(countActiveActivities([
    agent({ id: 'queued', status: 'queued' }),
    agent({ id: 'blocked', status: 'blocked' }),
    agent({ id: 'done', status: 'done' }),
    agent({ id: 'failed', status: 'failed' }),
    agent({ id: 'workflow-agent', workflowRunId: 'run-running', status: 'running' }),
  ], [workflow('running'), workflow('paused'), workflow('completed'), workflow('failed')])).toBe(4)
})

test('retained terminal activity still enables footer navigation', () => {
  const completedAt = 10_000
  expect(hasActivityToOpen([agent({ status: 'done', completedAt })], [], completedAt + 1_000)).toBe(true)
  expect(hasActivityToOpen([agent({ status: 'done', completedAt })], [], completedAt + 31_000)).toBe(false)
})

test('focused messages are limited to agent tasks that can consume a mailbox', () => {
  expect(canMessageSubagent(agent({ status: 'running', type: 'agent' }))).toBe(true)
  expect(canMessageSubagent(agent({ status: 'done', type: 'agent' }))).toBe(false)
  expect(canMessageSubagent(agent({ status: 'running', type: 'shell' }))).toBe(false)
})

test('activity focus selection can return to main without losing the selected agent identity', () => {
  const agents = [agent({ id: 'reviewer', agentName: 'Reviewer' })]
  const selected: ActivityFocusSelection = { kind: 'subagent', id: 'reviewer' }

  expect(resolveActivityFocus(selected, agents)).toEqual({ id: 'reviewer', agentName: 'Reviewer' })
  expect(resolveActivityFocus({ kind: 'main' }, agents)).toBeNull()
})

test('only the owning session can control a workflow activity row', () => {
  expect(canControlWorkflowRun(workflow('running'), 'session')).toBe(true)
  expect(canControlWorkflowRun({ ...workflow('running'), sessionId: 'other-session' }, 'session')).toBe(false)
  expect(canControlWorkflowRun(workflow('running'), undefined)).toBe(false)
})

test('workflow footer resume calls resume instead of falling through to pause', async () => {
  const calls: string[] = []
  const workflows = {
    cancel: async () => { calls.push('stop'); return true },
    pause: async () => { calls.push('pause'); return true },
    resume: async () => { calls.push('resume'); return true },
  }
  await expect(runWorkflowFooterAction(workflows, 'workflow-123', 'resume')).resolves.toContain('resumed')
  expect(calls).toEqual(['resume'])
})

test('subagent status line config accepts only a non-empty command object', () => {
  expect(validateSubagentStatusLineConfig({ type: 'command', command: 'printf ok' })).toEqual({
    type: 'command', command: 'printf ok',
  })
  expect(validateSubagentStatusLineConfig({ type: 'command', command: '  ' })).toBeUndefined()
  expect(validateSubagentStatusLineConfig('printf ok')).toBeUndefined()
  expect(validateSubagentStatusLineConfig({ type: 'shell', command: 'printf ok' })).toBeUndefined()
})

test('only a valid user-scoped status line config can enable command execution', () => {
  expect(getTrustedUserStatusLineConfig({
    interface: { subagentStatusLine: { type: 'command', command: 'printf ok' } },
  })).toEqual({ type: 'command', command: 'printf ok' })
  expect(getTrustedUserStatusLineConfig({
    interface: { subagentStatusLine: { type: 'command', command: '  ' } },
  })).toBeUndefined()
  expect(getTrustedUserStatusLineConfig({
    subagentStatusLine: { type: 'command', command: 'printf project' },
  })).toBeUndefined()
})

test('status line trust opens only when a sanitized effective settings snapshot contains the command', () => {
  expect(statusLineTrustFromEffectiveSettings({
    interface: { subagentStatusLine: { type: 'command', command: 'printf project' } },
  })).toBe(true)
  expect(statusLineTrustFromEffectiveSettings({ interface: {} })).toBe(false)
  expect(statusLineTrustFromEffectiveSettings(undefined)).toBe(false)
})

test('subagent status line input is built from current agents and active workflows', () => {
  const startedAt = 1_700_000_000_000
  const paused = workflow('paused')
  paused.startedAt = new Date(startedAt).toISOString()
  const input = buildSubagentStatusLineInput(
    [agent({ id: 'agent-1', agentName: 'Reviewer', startedAt, tokens: 12, workspace: '/workspace', parentTaskId: 'parent', type: 'review' })],
    [paused],
    120,
    '/project',
    startedAt,
  )
  expect(input.columns).toBe(120)
  expect(input.tasks).toEqual([
    expect.objectContaining({
      id: 'agent-1', name: 'Reviewer', type: 'review', status: 'running',
      parentTaskId: 'parent', description: 'inspect the project', startTime: startedAt, tokenCount: 12, cwd: '/workspace',
    }),
    expect.objectContaining({
      id: 'run-paused', name: 'audit', type: 'workflow', status: 'paused',
      description: 'Dynamic Workflow', startTime: startedAt, tokenCount: 0, cwd: '/project',
    }),
  ])
})

test('subagent status line parser keeps valid current task rows and drops invalid or stale rows', () => {
  const output = [
    JSON.stringify({ id: 'agent-1', content: 'reviewing' }),
    JSON.stringify({ id: 'stale', content: 'must not render' }),
    JSON.stringify({ id: 'agent-1', content: 'latest wins' }),
    JSON.stringify({ id: 'agent-1', content: 42 }),
    'not json',
  ].join('\n')
  expect([...parseSubagentStatusLineOutput(output, new Set(['agent-1']))]).toEqual([
    ['agent-1', 'latest wins'],
  ])
})

test('subagent status line executor does not run an untrusted workspace command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-status-line-'))
  const sentinel = join(directory, 'executed')
  try {
    const result = await runSubagentStatusLine(
      { type: 'command', command: `printf executed > "${sentinel}"` },
      { columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] },
      { cwd: process.cwd(), trusted: false },
    )
    expect(result.size).toBe(0)
    await expect(access(sentinel)).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('subagent status line executor accepts JSONL from a trusted command', async () => {
  const result = await runSubagentStatusLine(
    { type: 'command', command: "printf '%s\\n' '{\"id\":\"agent-1\",\"content\":\"ready\"}'" },
    { columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] },
    { cwd: process.cwd(), trusted: true },
  )
  expect(result.get('agent-1')).toBe('ready')
})

test('subagent status line fails closed when stdout exceeds the bounded output limit', async () => {
  const result = await runSubagentStatusLine(
    {
      type: 'command',
      command: `printf '%s\\n' '{"id":"agent-1","content":"ready"}'; head -c ${SUBAGENT_STATUS_LINE_MAX_OUTPUT_BYTES + 128} /dev/zero`,
    },
    { columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] },
    { cwd: process.cwd(), trusted: true },
  )
  expect(result.size).toBe(0)
})

test('subagent status line does not parse JSONL emitted beyond the output limit', async () => {
  const result = await runSubagentStatusLine(
    {
      type: 'command',
      command: `head -c ${SUBAGENT_STATUS_LINE_MAX_OUTPUT_BYTES + 128} /dev/zero; printf '\\n%s\\n' '{"id":"agent-1","content":"too late"}'`,
    },
    { columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] },
    { cwd: process.cwd(), trusted: true },
  )
  expect(result.size).toBe(0)
})

test('subagent status line executor kills a command after its timeout', async () => {
  const started = Date.now()
  const result = await runSubagentStatusLine(
    { type: 'command', command: 'sleep 1' },
    { columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] },
    { cwd: process.cwd(), trusted: true, timeoutMs: 30 },
  )
  expect(result.size).toBe(0)
  expect(Date.now() - started).toBeLessThan(500)
})

test('subagent status line timeout cancels a descendant that keeps stdout open', async () => {
  const started = Date.now()
  const result = await runSubagentStatusLine(
    { type: 'command', command: 'sleep 1 & wait' },
    { columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] },
    { cwd: process.cwd(), trusted: true, timeoutMs: 30 },
  )
  expect(result.size).toBe(0)
  expect(Date.now() - started).toBeLessThan(500)
})

test('subagent status line scheduler debounces notifications and refreshes until stopped', async () => {
  let calls = 0
  const updates: string[] = []
  const scheduler = createSubagentStatusLineScheduler({
    config: { type: 'command', command: 'ignored' },
    cwd: process.cwd(),
    trusted: true,
    getInput: () => ({ columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] }),
    onUpdate: decorations => updates.push(decorations.get('agent-1') ?? ''),
    debounceMs: 20,
    refreshMs: 100,
    execute: async () => {
      calls++
      return new Map([['agent-1', `update-${calls}`]])
    },
  })

  scheduler.start()
  await Bun.sleep(5)
  expect(calls).toBe(0)
  await Bun.sleep(30)
  expect(calls).toBe(1)
  scheduler.notify()
  scheduler.notify()
  await Bun.sleep(5)
  expect(calls).toBe(1)
  await Bun.sleep(30)
  expect(calls).toBe(2)
  expect(updates).toEqual(['update-1', 'update-2'])
  scheduler.stop()
  await Bun.sleep(120)
  expect(calls).toBe(2)
})

test('subagent status line scheduler resolves its working directory per refresh', async () => {
  let cwd = '/first'
  const seen: string[] = []
  const scheduler = createSubagentStatusLineScheduler({
    config: { type: 'command', command: 'ignored' },
    cwd: () => cwd,
    trusted: true,
    getInput: () => ({ columns: 80, tasks: [{ id: 'agent-1', status: 'running' }] }),
    onUpdate: () => {},
    debounceMs: 0,
    refreshMs: 100,
    execute: async (_config, _input, options) => {
      seen.push(options.cwd)
      return new Map()
    },
  })
  scheduler.start()
  await Bun.sleep(20)
  cwd = '/second'
  scheduler.notify()
  await Bun.sleep(20)
  scheduler.stop()
  expect(seen).toContain('/first')
  expect(seen).toContain('/second')
})
