import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import type { MessageOrBoundary } from '../src/agent/compactBoundary.js'
import { SessionEvidence } from '../src/agent/sessionEvidence.js'
import { redactSecrets } from '../src/orchestration/events.js'
import { runScript } from './platform-commands.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'

function addAttempt(evidence: SessionEvidence, turnId: string, toolCallId: string, toolName: string, hooksMayHaveEffects = false): void {
  evidence.add('tool', `task-effect-attempt:${turnId}:${toolCallId}`, JSON.stringify({
    schema: 'primary_task_effect_attempt_v1',
    taskId: turnId,
    toolCallId,
    toolName,
    state: 'unknown',
    manualReviewRequired: true,
    ...(hooksMayHaveEffects ? { hooksMayHaveEffects: true } : {}),
  }))
}

async function readFileEventually(path: string): Promise<string> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try { return await readFile(path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw new Error(`Timed out waiting for ${path}`)
}

function effectHookCommand(checkpointPath: string, effectPath: string): string {
  return runScript(`const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(effectPath)}, fs.existsSync(${JSON.stringify(checkpointPath)}) ? 'checkpointed' : 'missing')`)
}

function evidenceFromCheckpoint(messages: readonly unknown[]): Array<{ source: string; text: string }> {
  const evidence = messages.find((message): message is { name?: string; content?: string | null } =>
    Boolean(message && typeof message === 'object' && 'name' in message &&
      (message as { name?: unknown }).name === 'deepseek_runtime_evidence_v1'))
  return JSON.parse(typeof evidence?.content === 'string' ? evidence.content : '[]')
}

async function stageBackgroundSubagent(agent: Agent, turnId: string, callId: string, linkedCallId = callId) {
  const internal = agent as any
  internal.turnEffectTaskId = turnId
  internal.settings = { permissions: { allow: ['subagent'], deny: [] }, risk: { enabled: false } }
  let releaseTask!: () => void
  let markStarted!: () => void
  let receiptText = ''
  let monitor: Promise<void> = Promise.resolve()
  const gate = new Promise<void>(resolve => { releaseTask = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  const originalTool = internal.toolMap.get('subagent')
  internal.toolMap.set('subagent', {
    ...originalTool,
    execute: async (_args: Record<string, unknown>, context: { effectId?: string; markEffectOutcome?: (id: string, state: 'effect-observed', receipt: string) => Promise<void> }) => {
      const handle = internal.orchestrator.registry.spawn({
        taskId: `background-${callId}`,
        mode: 'background',
        effectPolicy: 'tool-gated',
        maxRetries: 0,
        permissionProfile: 'researcher-readonly',
        metadata: { origin: 'subagent', mode: 'background', primaryEffectId: linkedCallId },
      }, async (taskContext: { markEffectStarted(tool: string): Promise<string>; markEffectOutcome(id: string, state: 'effect-observed', evidence: string): Promise<void> }) => {
        const effectId = await taskContext.markEffectStarted('write_file')
        markStarted()
        await gate
        await taskContext.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'c'.repeat(64)}`)
        return 'completed'
      })
      monitor = handle.awaitResult().then(async () => {
        const aggregate = internal.orchestrator.registry.getObservedEffectAggregate(handle.taskId)
        receiptText = JSON.stringify({
          schema: 'primary_subagent_background_outcome_v1',
          taskId: handle.taskId,
          evidence: aggregate.positiveEvidence,
        })
        await context.markEffectOutcome!(context.effectId!, 'effect-observed', receiptText)
      })
      return JSON.stringify({ taskId: handle.taskId, state: handle.status().state })
    },
  })
  const call = {
    id: callId,
    type: 'function' as const,
    function: { name: 'subagent', arguments: JSON.stringify({ task: 'Run a child task', mode: 'background' }) },
  }
  const execution = await internal.checkAndExecuteTool(call, JSON.parse(call.function.arguments), callbacks())
  return {
    execution,
    started,
    releaseTask,
    waitForMonitor: () => monitor,
    receipt: () => receiptText,
    taskId: `background-${callId}`,
  }
}

const callbacks = () => ({ onToken() {}, onThinking() {}, onToolCall() {}, onToolResult() {}, onDone() {}, onDenyAbort() {}, onAutoCompact() {} })

describe('primary task effect reconciliation', () => {
  let root: string | undefined
  let agent: Agent | undefined

  afterEach(async () => {
    await agent?.shutdown()
    if (root) await removeTempDirectory(root)
    agent = undefined
    root = undefined
  })

  it('persists known receipts while keeping an unclassified integration outcome unknown', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-effects-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.turnEffectTaskId = 'task-reconciliation-test'
    internal.beginPrimaryTaskEffectAttempt('write-call', 'write_file')
    const writeEvidenceId = internal.sessionEvidence.add('tool', 'file-effect-outcome:write-call', JSON.stringify({ state: 'effect-observed' }))
    internal.recordPrimaryTaskEffectOutcome('write-call', 'write_file', 'effect-observed', writeEvidenceId)
    internal.beginPrimaryTaskEffectAttempt('shell-call', 'shell')
    const shellEvidenceId = internal.sessionEvidence.add('tool', 'shell-effect-outcome:shell-call', JSON.stringify({ state: 'effect-observed' }))
    internal.recordPrimaryTaskEffectOutcome('shell-call', 'shell', 'effect-observed', shellEvidenceId)
    internal.beginPrimaryTaskEffectAttempt('mcp-call', 'external_database_query')
    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const reconciliation = entries.find(entry => entry.source === 'task-effect-reconciliation:task-reconciliation-test')
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_reconciliation_v1',
      state: 'unknown',
      manualReviewRequired: true,
      unknownDomains: ['Shell network, database, and arbitrary non-workspace effects'],
      attempts: [
        { toolCallId: 'write-call', toolName: 'write_file', state: 'effect-observed', evidenceId: writeEvidenceId },
        { toolCallId: 'shell-call', toolName: 'shell', state: 'effect-observed', evidenceId: shellEvidenceId },
        { toolCallId: 'mcp-call', toolName: 'external_database_query', state: 'unknown' },
      ],
    })
  })

  it('records no-effect only when all tracked attempts have durable no-effect receipts', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-no-effect-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.turnEffectTaskId = 'task-no-effect-test'
    internal.beginPrimaryTaskEffectAttempt('git-call', 'git')
    const evidenceId = internal.sessionEvidence.add('tool', 'git-effect-outcome:git-call', JSON.stringify({ state: 'no-effect' }))
    internal.recordPrimaryTaskEffectOutcome('git-call', 'git', 'no-effect', evidenceId)
    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const reconciliation = entries.find(entry => entry.source === 'task-effect-reconciliation:task-no-effect-test')
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({
      state: 'no-effect',
      manualReviewRequired: false,
      attempts: [{ toolCallId: 'git-call', toolName: 'git', state: 'no-effect', evidenceId }],
    })
  })

  it('passes the persisted primary foreground subagent call ID into durable effect reconciliation', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-subagent-effects-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'primary-foreground-subagent-test'
    const callId = 'primary-foreground-subagent-call'
    const evidence = `descendant-effects-sha256:${'d'.repeat(64)}`
    internal.turnEffectTaskId = turnId
    internal.settings = { permissions: { allow: ['subagent'], deny: [] }, risk: { enabled: false } }
    const subagent = internal.toolMap.get('subagent')
    internal.toolMap.set('subagent', {
      ...subagent,
      execute: async (_args: Record<string, unknown>, context: { effectId?: string; markEffectOutcome?: (id: string, state: 'effect-observed', receipt: string) => Promise<void> }) => {
        expect(context.effectId).toBe(callId)
        expect(context.markEffectOutcome).toBeFunction()
        await context.markEffectOutcome!(callId, 'effect-observed', evidence)
        return 'child completed'
      },
    })
    const call = {
      id: callId,
      type: 'function' as const,
      function: { name: 'subagent', arguments: JSON.stringify({ task: 'Run a child task', mode: 'foreground' }) },
    }

    const result = await (internal as any).checkAndExecuteTool(call, JSON.parse(call.function.arguments), callbacks())
    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())

    expect(result.result).toBe('child completed')
    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ id: string; source: string; text: string }>
    const outcome = entries.find(entry => entry.source === `subagent-effect-outcome:${callId}`)
    const reconciliation = entries.find(entry => entry.source === `task-effect-reconciliation:${turnId}`)
    expect(JSON.parse(outcome?.text ?? '{}')).toMatchObject({ state: 'effect-observed', evidence })
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({
      state: 'effect-observed',
      attempts: [{ toolCallId: callId, toolName: 'subagent', state: 'effect-observed', evidenceId: outcome?.id }],
    })
  })

  it('updates the original turn summary after a linked background subtree settles', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-background-subagent-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: join(root, 'tasks.json'),
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'primary-background-subagent-turn'
    const callId = 'primary-background-subagent-call'
    const staged = await stageBackgroundSubagent(agent, turnId, callId)
    await staged.started
    expect(JSON.parse(staged.execution.result).taskId).toBe(staged.taskId)
    await internal.persistPrimaryTaskEffectReconciliation()

    internal.turnEffectTaskId = 'next-primary-turn'
    internal.turnEffectAttempts.clear()
    staged.releaseTask()
    await staged.waitForMonitor()

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ id: string; source: string; text: string }>
    const reconciliation = entries.filter(entry => entry.source === `task-effect-reconciliation:${turnId}`).at(-1)
    const outcome = entries.filter(entry => entry.source === `subagent-effect-outcome:${callId}`)
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({
      taskId: turnId,
      state: 'effect-observed',
      manualReviewRequired: false,
      attempts: [{ toolCallId: callId, toolName: 'subagent', state: 'effect-observed', evidenceId: outcome[0]?.id }],
    })
    expect(outcome).toHaveLength(1)

    await internal.persistPrimaryBackgroundSubagentOutcome(turnId, callId, staged.receipt())
    const afterDuplicate = internal.sessionEvidence.toolSources().filter((entry: { source: string }) => entry.source === `subagent-effect-outcome:${callId}`)
    expect(afterDuplicate).toHaveLength(1)
  })

  it('keeps background outcomes unknown when the child identity does not match the primary call', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-background-mismatch-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: join(root, 'tasks.json'),
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'primary-background-mismatch-turn'
    const callId = 'primary-background-mismatch-call'
    const staged = await stageBackgroundSubagent(agent, turnId, callId, 'different-primary-call')
    await staged.started
    await internal.persistPrimaryTaskEffectReconciliation()
    staged.releaseTask()
    await staged.waitForMonitor()

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const reconciliation = entries.filter(entry => entry.source === `task-effect-reconciliation:${turnId}`).at(-1)
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({ state: 'unknown', manualReviewRequired: true })
    expect(entries.some(entry => entry.source === `subagent-effect-outcome:${callId}`)).toBe(false)
  })

  it('leaves a late background summary unknown when its checkpoint fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-background-checkpoint-failure-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    let failObservedSummary = false
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: join(root, 'tasks.json'),
      checkpointHistory: async messages => {
        const entries = evidenceFromCheckpoint(messages)
        const summaries = entries.filter(entry => entry.source === 'task-effect-reconciliation:primary-background-checkpoint-failure-turn')
        const latest = summaries.at(-1)
        if (failObservedSummary && latest && JSON.parse(latest.text).state === 'effect-observed') throw new Error('late summary checkpoint unavailable')
        checkpoints.push(messages as Array<{ name?: string; content?: string }>)
      },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'primary-background-checkpoint-failure-turn'
    const callId = 'primary-background-checkpoint-failure-call'
    const staged = await stageBackgroundSubagent(agent, turnId, callId)
    await staged.started
    await internal.persistPrimaryTaskEffectReconciliation()
    failObservedSummary = true
    staged.releaseTask()
    await expect(staged.waitForMonitor()).rejects.toThrow('late summary checkpoint unavailable')

    const entries = internal.sessionEvidence.toolSources() as Array<{ source: string; text: string }>
    const reconciliation = entries.filter(entry => entry.source === `task-effect-reconciliation:${turnId}`).at(-1)
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({ state: 'unknown', manualReviewRequired: true })
    expect(JSON.parse(reconciliation?.text ?? '{}').attempts).toMatchObject([
      { toolCallId: callId, toolName: 'subagent', state: 'unknown' },
    ])
  })

  it('fails closed when the bounded attempt ledger omits calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-effects-bound-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.turnEffectTaskId = 'task-bounded-test'
    for (let index = 0; index <= 128; index++) internal.beginPrimaryTaskEffectAttempt(`call-${index}`, 'external_tool')
    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const reconciliation = entries.find(entry => entry.source === 'task-effect-reconciliation:task-bounded-test')
    const summary = JSON.parse(reconciliation?.text ?? '{}') as { attempts: unknown[] }
    expect(summary).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      omittedAttempts: 1,
    })
    expect(summary.attempts).toHaveLength(128)
  })

  it('recovers interrupted summaries per exact turn and ignores stale call evidence', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-recovery-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const evidence = new SessionEvidence()
    addAttempt(evidence, 'turn-observed', 'reused-call-id', 'git')
    const observedEvidenceId = evidence.add('tool', 'git-effect-outcome:reused-call-id', JSON.stringify({
      state: 'effect-observed', evidence: `effect-observed:${'a'.repeat(64)}`,
    }))
    addAttempt(evidence, 'turn-stale', 'reused-call-id', 'git')

    await agent.loadSessionMessages([
      { role: 'system', content: (agent as any).systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'reused-call-id', type: 'function', function: { name: 'git', arguments: '{"action":"commit"}' } },
        { id: 'reused-call-id', type: 'function', function: { name: 'git', arguments: '{"action":"commit"}' } },
      ] },
      evidence.snapshot(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ id: string; source: string; text: string }>
    const observed = entries.find(entry => entry.source === 'task-effect-reconciliation:turn-observed')
    const stale = entries.find(entry => entry.source === 'task-effect-reconciliation:turn-stale')
    expect(JSON.parse(observed?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_reconciliation_v1',
      taskId: 'turn-observed',
      state: 'effect-observed',
      interrupted: true,
      recovered: true,
      attempts: [{ toolCallId: 'reused-call-id', toolName: 'git', state: 'effect-observed', evidenceId: observedEvidenceId }],
    })
    expect(JSON.parse(stale?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_reconciliation_v1',
      taskId: 'turn-stale',
      state: 'unknown',
      manualReviewRequired: true,
      interrupted: true,
      recovered: true,
      uncoveredDomains: expect.arrayContaining(['Unmatched, stale, or malformed per-call evidence']),
      attempts: [{ toolCallId: 'reused-call-id', toolName: 'git', state: 'unknown' }],
    })
    const ambiguousToolResult = agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === 'reused-call-id')
    expect(String(ambiguousToolResult?.content)).toContain('may have executed')
    expect(String(ambiguousToolResult?.content)).toContain('Do not replay it automatically')
  })

  it('recovers a late background SubAgent receipt only from its exact restored task and call', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-background-recovery-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: join(root, 'orchestration.json'),
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'turn-background-recovery'
    const callId = 'background-subagent-call'
    const childTaskId = 'background-child-after-restart'
    internal.turnEffectTaskId = turnId
    internal.persistPrimaryTaskEffectAttempt(callId, 'subagent')
    await internal.options.checkpointHistory(internal.getRawMessages())

    const child = internal.orchestrator.registry.spawn({
      taskId: childTaskId,
      mode: 'background',
      effectPolicy: 'tool-gated',
      maxRetries: 0,
      metadata: { origin: 'subagent', mode: 'background', primaryEffectId: callId },
    }, async (context: { markEffectStarted(tool: string): Promise<string>; markEffectOutcome(id: string, state: 'effect-observed', evidence: string): Promise<void> }) => {
      const effectId = await context.markEffectStarted('write_file')
      await context.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'a'.repeat(64)}`)
      return 'completed'
    })
    await child.awaitResult()
    await internal.orchestrator.registry.awaitSubtreeSettled(childTaskId)
    const aggregate = internal.orchestrator.registry.getObservedEffectAggregate(childTaskId)
    expect(aggregate.allRecordedEffectsSettled).toBe(true)
    expect(aggregate.positiveEvidence).toMatch(/^descendant-effects-sha256:[a-f0-9]{64}$/)
    internal.sessionEvidence.add('tool', `subagent-effect-outcome:${callId}`, JSON.stringify({
      schema: 'primary_subagent_background_outcome_v1',
      taskId: turnId,
      toolCallId: callId,
      childTaskId,
      state: 'effect-observed',
      evidence: aggregate.positiveEvidence,
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'subagent', arguments: '{"task":"Run child","mode":"background"}' } },
      ] },
      internal.sessionEvidence.snapshot(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ id: string; source: string; text: string }>
    const summary = entries.find(entry => entry.source === `task-effect-reconciliation:${turnId}`)
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_reconciliation_v1',
      taskId: turnId,
      state: 'effect-observed',
      interrupted: true,
      recovered: true,
      attempts: [{
        toolCallId: callId,
        toolName: 'subagent',
        state: 'effect-observed',
        evidenceId: entries.find(entry => entry.source === `subagent-effect-outcome:${callId}`)?.id,
      }],
    })
  })

  it('revalidates persisted background receipts against the restored child after Agent recreation', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-background-durable-recovery-'))
    const sessionId = 'primary-background-durable-recovery-session'
    const snapshotFile = join(root, 'orchestration.json')
    let checkpoint: MessageOrBoundary[] = []
    const createAgent = async () => {
      const instance = new Agent({ provider: 'local', localModel: 'test-model' }, {
        projectRoot: root!, sessionId, logFile: null, snapshotFile,
        checkpointHistory: async messages => { checkpoint = structuredClone(messages) },
      })
      await instance.readyPromise
      return instance
    }

    agent = await createAgent()
    const internal = agent as any
    const turnId = 'turn-durable-background-recovery'
    const callId = 'reused-background-subagent-call'
    const childTaskId = 'durable-background-child'
    const call = {
      id: callId,
      type: 'function' as const,
      function: { name: 'subagent', arguments: '{"task":"Run child","mode":"background"}' },
    }
    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [call] },
      internal.sessionEvidence.snapshot(),
    ], false)

    internal.turnEffectTaskId = turnId
    internal.persistPrimaryTaskEffectAttempt(callId, 'subagent')
    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())

    const child = internal.orchestrator.registry.spawn({
      taskId: childTaskId,
      mode: 'background',
      effectPolicy: 'tool-gated',
      maxRetries: 0,
      permissionProfile: 'researcher-readonly',
      metadata: { origin: 'subagent', mode: 'background', primaryEffectId: callId },
    }, async (context: { markEffectStarted(tool: string): Promise<string>; markEffectOutcome(id: string, state: 'effect-observed', evidence: string): Promise<void> }) => {
      const effectId = await context.markEffectStarted('write_file')
      await context.markEffectOutcome(effectId, 'effect-observed', `file-sha256:${'b'.repeat(64)}`)
      return 'completed'
    })
    await child.awaitResult()
    await internal.orchestrator.flush()
    const aggregate = internal.orchestrator.registry.getObservedEffectAggregate(childTaskId)
    expect(aggregate.allRecordedEffectsSettled).toBe(true)
    expect(aggregate.positiveEvidence).toMatch(/^descendant-effects-sha256:[a-f0-9]{64}$/)

    internal.sessionEvidence.add('tool', `subagent-effect-outcome:${callId}`, JSON.stringify({
      schema: 'primary_subagent_background_outcome_v1',
      taskId: turnId,
      toolCallId: callId,
      childTaskId,
      state: 'effect-observed',
      evidence: aggregate.positiveEvidence,
    }))
    const preRecoveryMessages = structuredClone(internal.getRawMessages()) as MessageOrBoundary[]
    await internal.options.checkpointHistory(preRecoveryMessages)
    await internal.orchestrator.flush()
    await agent.shutdown()
    agent = undefined

    const savedSnapshot = JSON.parse(await readFile(snapshotFile, 'utf8')) as any
    expect(savedSnapshot.tasks.find((task: any) => task.taskId === childTaskId)).toMatchObject({
      state: 'done',
      metadata: { origin: 'subagent', mode: 'background', primaryEffectId: callId },
    })

    agent = await createAgent()
    const restored = (agent as any).orchestrator.registry
    expect(restored.getObservedEffectAggregate(childTaskId)).toMatchObject({
      allRecordedEffectsSettled: true,
      positiveEvidence: aggregate.positiveEvidence,
    })
    await agent.loadSessionMessages(preRecoveryMessages, true)
    let entries = evidenceFromCheckpoint(checkpoint)
    let firstTurn = entries.filter(entry => entry.source === `task-effect-reconciliation:${turnId}`).at(-1)
    expect(JSON.parse(firstTurn?.text ?? '{}')).toMatchObject({ state: 'effect-observed', recovered: true })
    await agent.shutdown()
    agent = undefined

    savedSnapshot.tasks.find((task: any) => task.taskId === childTaskId).metadata.primaryEffectId = 'different-call'
    await writeFile(snapshotFile, `${JSON.stringify(savedSnapshot)}\n`)
    agent = await createAgent()
    await agent.loadSessionMessages(preRecoveryMessages, true)
    entries = evidenceFromCheckpoint(checkpoint)
    firstTurn = entries.filter(entry => entry.source === `task-effect-reconciliation:${turnId}`).at(-1)
    expect(JSON.parse(firstTurn?.text ?? '{}')).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      uncoveredDomains: expect.arrayContaining([
        'Background SubAgent outcome could not be revalidated against its durable settled task',
      ]),
    })
  })

  it('keeps a late background receipt unknown when its child task is missing', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-background-recovery-missing-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'turn-missing-background-child'
    const callId = 'missing-background-child-call'
    const evidence = new SessionEvidence()
    addAttempt(evidence, turnId, callId, 'subagent')
    evidence.add('tool', `subagent-effect-outcome:${callId}`, JSON.stringify({
      schema: 'primary_subagent_background_outcome_v1',
      taskId: turnId,
      toolCallId: callId,
      childTaskId: 'not-restored',
      state: 'effect-observed',
      evidence: `descendant-effects-sha256:${'a'.repeat(64)}`,
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'subagent', arguments: '{"task":"Run child","mode":"background"}' } },
      ] },
      evidence.snapshot(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const summary = entries.find(entry => entry.source === `task-effect-reconciliation:${turnId}`)
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      uncoveredDomains: expect.arrayContaining([
        'Background SubAgent outcome could not be revalidated against its durable settled task',
      ]),
      attempts: [{ toolCallId: callId, toolName: 'subagent', state: 'unknown' }],
    })
  })

  it('reconstructs an interrupted summary even when a normal turn summary was already saved', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-prior-summary-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const internal = agent as any
    const turnId = 'turn-with-prior-summary'
    const callId = 'prior-summary-git-call'
    internal.turnEffectTaskId = turnId
    internal.persistPrimaryTaskEffectAttempt(callId, 'git')
    const outcomeId = internal.sessionEvidence.add('tool', `git-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed', evidence: `effect-observed:${'c'.repeat(64)}`,
    }))
    internal.recordPrimaryTaskEffectOutcome(callId, 'git', 'effect-observed', outcomeId)
    internal.recordPrimaryTaskEffectReconciliation()

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'git', arguments: '{"action":"commit"}' } },
      ] },
      ...agent.getRawMessages(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const summaries = (JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>)
      .filter(entry => entry.source === `task-effect-reconciliation:${turnId}`)
      .map(entry => JSON.parse(entry.text) as Record<string, unknown>)
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).not.toHaveProperty('interrupted', true)
    expect(summaries[1]).toMatchObject({
      state: 'effect-observed',
      interrupted: true,
      recovered: true,
      attempts: [{ toolCallId: callId, toolName: 'git', state: 'effect-observed', evidenceId: outcomeId }],
    })
  })

  it('does not accept a typed Git outcome when the transcript tool does not match the attempt', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-call-tool-mismatch-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const evidence = new SessionEvidence()
    const callId = 'mismatched-tool-call'
    addAttempt(evidence, 'turn-git-mismatch', callId, 'git')
    evidence.add('tool', `git-effect-outcome:${callId}`, JSON.stringify({
      state: 'no-effect', evidence: `no-effect:${'d'.repeat(64)}`,
    }))
    await agent.loadSessionMessages([
      { role: 'system', content: (agent as any).systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'shell', arguments: '{"command":"true"}' } },
      ] },
      evidence.snapshot(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const summary = entries.find(entry => entry.source === 'task-effect-reconciliation:turn-git-mismatch')
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      uncoveredDomains: expect.arrayContaining(['Unmatched, stale, or malformed per-call evidence']),
      attempts: [{ toolCallId: callId, toolName: 'git', state: 'unknown' }],
    })
  })

  it('recovers exact shell workspace receipts while keeping external shell effects unknown', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-shell-recovery-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const turnId = 'turn-shell-workspace-recovery'
    const callId = 'shell-workspace-recovery-call'
    const evidence = new SessionEvidence()
    addAttempt(evidence, turnId, callId, 'shell')
    const outcomeId = evidence.add('tool', `shell-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      evidence: `shell-workspace-changed:${'e'.repeat(64)}`,
    }))
    await agent.loadSessionMessages([
      { role: 'system', content: (agent as any).systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'shell', arguments: '{"command":"write output"}' } },
      ] },
      evidence.snapshot(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const summary = entries.find(entry => entry.source === `task-effect-reconciliation:${turnId}`)
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      uncoveredDomains: expect.arrayContaining(['Shell network, database, and arbitrary non-workspace effects']),
      attempts: [{ toolCallId: callId, toolName: 'shell', state: 'effect-observed', evidenceId: outcomeId }],
    })
  })

  it('blocks resume when the recovered summary cannot be persisted and keeps opaque effects unknown', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-recovery-failure-'))
    let checkpointAttempt: Array<{ name?: string; content?: string }> | undefined
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        checkpointAttempt = messages as Array<{ name?: string; content?: string }>
        throw new Error('recovery checkpoint unavailable')
      },
    })
    await agent.readyPromise
    const evidence = new SessionEvidence()
    addAttempt(evidence, 'turn-shell', 'shell-call', 'shell')
    addAttempt(evidence, 'turn-shell', 'mcp-call', 'mcp__database__query')
    const internal = agent as any
    internal.settings.hooks = { onToolCall: [] }

    await expect(agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: 'The shell operation completed successfully.' },
      evidence.snapshot(),
    ], true)).rejects.toThrow('could not be durably saved')

    const snapshot = checkpointAttempt?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(snapshot?.content ?? '[]') as Array<{ source: string; text: string }>
    const summary = entries.find(entry => entry.source === 'task-effect-reconciliation:turn-shell')
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      interrupted: true,
      recovered: true,
      uncoveredDomains: expect.arrayContaining(['Shell network, database, and arbitrary non-workspace effects']),
      attempts: expect.arrayContaining([
        { toolCallId: 'mcp-call', toolName: 'mcp__database__query', state: 'unknown', attemptEvidenceId: expect.any(String) },
      ]),
    })
    expect(JSON.parse(summary?.text ?? '{}').uncoveredDomains).toEqual(expect.arrayContaining([
      'MCP and other opaque external tool effects',
      'Configured hooks may have additional effects',
    ]))
    await expect(agent.run('Continue the interrupted task.', {
      onToken() {},
      onToolCall() {},
      onToolResult() {},
      onDone() {},
    })).rejects.toThrow('session resume is unsafe')
  })

  it('keeps recovered summaries unknown when the persisted attempt ledger reaches its bound', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-recovery-bound-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise

    const evidence = new SessionEvidence()
    const toolCalls = Array.from({ length: 129 }, (_, index) => {
      const callId = `bounded-call-${index}`
      addAttempt(evidence, 'turn-at-bound', callId, 'git')
      evidence.add('tool', `git-effect-outcome:${callId}`, JSON.stringify({
        state: 'no-effect', evidence: `no-effect:${String(index).padStart(64, 'a')}`,
      }))
      return { id: callId, type: 'function' as const, function: { name: 'git', arguments: '{"action":"status"}' } }
    })

    await agent.loadSessionMessages([
      { role: 'system', content: (agent as any).systemPrompt },
      { role: 'assistant', content: null, tool_calls: toolCalls },
      evidence.snapshot(),
    ], true)

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const summary = entries.find(entry => entry.source === 'task-effect-reconciliation:turn-at-bound')
    const recovered = JSON.parse(summary?.text ?? '{}') as { attempts: Array<{ state: string }> }
    expect(recovered).toMatchObject({
      state: 'unknown',
      manualReviewRequired: true,
      omittedAttempts: 1,
      attemptLedgerAtBound: true,
    })
    expect(recovered.attempts).toHaveLength(128)
    expect(recovered.attempts.some(attempt => attempt.state === 'no-effect')).toBe(true)
  })

  it('recovers direct file receipts while preserving hook uncertainty from persisted attempts', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-file-recovery-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(messages as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise
    const callId = 'recovered-write-call'
    const path = join(root, 'report.txt')
    const args = { path, content: 'report' }
    const digest = createHash('sha256').update(JSON.stringify(redactSecrets(args))).digest('hex')
    const hookedCallId = 'recovered-hooked-write-call'
    const hookedPath = join(root, 'hooked-report.txt')
    const hookedArgs = { path: hookedPath, content: 'report with a post hook' }
    const hookedDigest = createHash('sha256').update(JSON.stringify(redactSecrets(hookedArgs))).digest('hex')
    const postHash = 'b'.repeat(64)
    const evidence = new SessionEvidence()
    addAttempt(evidence, 'turn-file', callId, 'write_file')
    const receiptEvidenceId = evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: digest,
      requestedPath: path,
      checkpointId: 'file-checkpoint',
      path,
      postVersion: { exists: true, hash: postHash },
    }))
    addAttempt(evidence, 'turn-file', hookedCallId, 'write_file', true)
    evidence.add('tool', `file-effect-outcome:${hookedCallId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: hookedCallId,
      toolCallId: hookedCallId,
      toolName: 'write_file',
      argsDigest: hookedDigest,
      requestedPath: hookedPath,
      checkpointId: 'hooked-file-checkpoint',
      path: hookedPath,
      postVersion: { exists: true, hash: postHash },
    }))

    ;(agent as any).settings.hooks = undefined

    await agent.loadSessionMessages([
      { role: 'system', content: (agent as any).systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
        { id: hookedCallId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(hookedArgs) } },
      ] },
      evidence.snapshot(),
    ], true, undefined, [
      {
        id: 'file-checkpoint',
        timestamp: Date.now(),
        path,
        backupFile: 'backup',
        toolName: 'write_file',
        postExisted: true,
        postHash,
      },
      {
        id: 'hooked-file-checkpoint',
        timestamp: Date.now(),
        path: hookedPath,
        backupFile: 'hooked-backup',
        toolName: 'write_file',
        postExisted: true,
        postHash,
      },
    ])

    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const summary = entries.find(entry => entry.source === 'task-effect-reconciliation:turn-file')
    const recovered = JSON.parse(summary?.text ?? '{}') as { state: string; manualReviewRequired: boolean; attempts: Array<Record<string, unknown>> }
    expect(recovered).toMatchObject({ state: 'unknown', manualReviewRequired: true })
    expect(recovered.attempts).toEqual(expect.arrayContaining([
      { toolCallId: callId, toolName: 'write_file', state: 'effect-observed', evidenceId: receiptEvidenceId, attemptEvidenceId: expect.any(String) },
      { toolCallId: hookedCallId, toolName: 'write_file', state: 'unknown', hooksMayHaveEffects: true, attemptEvidenceId: expect.any(String) },
    ]))
    const result = agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)
    expect(String(result?.content)).toContain('effect-observed')
    expect(String(result?.content)).toContain(postHash)
  })

  it('persists unknown external tool effects when Agent.run completes normally', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-run-effects-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    let pendingCallCheckpoint: Array<any> | undefined
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages) as Array<any>
        checkpoints.push(snapshot)
        const hasUnmatchedCall = snapshot.some(message => message.role === 'assistant' &&
          message.tool_calls?.some((call: { id?: string }) => call.id === 'web-fetch-reconciliation-call') &&
          !snapshot.some(response => response.role === 'tool' && response.tool_call_id === 'web-fetch-reconciliation-call'))
        if (hasUnmatchedCall) pendingCallCheckpoint = snapshot
      },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = { permissions: { allow: ['web_fetch'], deny: [] }, risk: { enabled: false }, hooks: undefined }
    internal.fetchBalance = async () => undefined
    agent.setToolPermissionHandler(async () => 'once')

    const webFetch = internal.toolMap.get('web_fetch')
    let fetchExecutions = 0
    internal.toolMap.set('web_fetch', {
      ...webFetch,
      execute: async () => {
        expect(pendingCallCheckpoint).toBeDefined()
        const attempt = JSON.parse(pendingCallCheckpoint!.find(message => message.name === 'deepseek_runtime_evidence_v1')?.content ?? '[]')
          .find((entry: { source: string }) => entry.source.startsWith('task-effect-attempt:'))
        expect(JSON.parse(attempt.text)).toMatchObject({
          schema: 'primary_task_effect_attempt_v1',
          toolCallId: 'web-fetch-reconciliation-call',
          toolName: 'web_fetch',
          state: 'unknown',
          manualReviewRequired: true,
        })
        expect(pendingCallCheckpoint!.some(message => message.role === 'tool' && message.tool_call_id === 'web-fetch-reconciliation-call')).toBe(false)
        fetchExecutions++
        return 'Deterministic fixture response.'
      },
    })

    const stream = (chunks: object[]): AsyncIterable<object> => ({
      async *[Symbol.asyncIterator]() { yield* chunks },
    })
    let modelRequests = 0
    internal.openStream = async () => {
      modelRequests++
      if (modelRequests === 1) {
        return stream([{
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'web-fetch-reconciliation-call',
                type: 'function',
                function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://fixture.invalid/report' }) },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }])
      }
      return stream([{ choices: [{ delta: { content: 'The page was retrieved.' }, finish_reason: 'stop' }] }])
    }

    await agent.run('Retrieve the report.', {
      onToken() {},
      onToolCall() {},
      onToolResult() {},
      onDone() {},
    })

    expect(modelRequests).toBe(2)
    expect(fetchExecutions).toBe(1)
    const savedEvidence = checkpoints.at(-1)?.find(message => message.name === 'deepseek_runtime_evidence_v1')
    const entries = JSON.parse(savedEvidence?.content ?? '[]') as Array<{ source: string; text: string }>
    const reconciliation = entries.find(entry => entry.source.startsWith('task-effect-reconciliation:'))
    expect(JSON.parse(reconciliation?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_reconciliation_v1',
      state: 'unknown',
      manualReviewRequired: true,
      attempts: [{
        toolCallId: 'web-fetch-reconciliation-call',
        toolName: 'web_fetch',
        state: 'unknown',
      }],
    })
  })

  it('does not execute a tool when its unmatched call and unknown attempt cannot be checkpointed', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-task-checkpoint-failure-'))
    let failedCheckpoint: Array<any> | undefined
    let executorRuns = 0
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages) as Array<any>
        const hasUnmatchedCall = snapshot.some(message => message.role === 'assistant' &&
          message.tool_calls?.some((call: { id?: string }) => call.id === 'web-fetch-checkpoint-failure-call') &&
          !snapshot.some(response => response.role === 'tool' && response.tool_call_id === 'web-fetch-checkpoint-failure-call'))
        if (!hasUnmatchedCall) return
        failedCheckpoint = snapshot
        throw new Error('durable checkpoint unavailable')
      },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = { permissions: { allow: ['web_fetch'], deny: [] }, risk: { enabled: false }, hooks: undefined }
    internal.fetchBalance = async () => undefined
    agent.setToolPermissionHandler(async () => 'once')
    const webFetch = internal.toolMap.get('web_fetch')
    internal.toolMap.set('web_fetch', {
      ...webFetch,
      execute: async () => {
        executorRuns++
        return 'This must not run.'
      },
    })

    const stream = (chunks: object[]): AsyncIterable<object> => ({
      async *[Symbol.asyncIterator]() { yield* chunks },
    })
    let modelRequests = 0
    internal.openStream = async () => {
      modelRequests++
      if (modelRequests > 1) return stream([{ choices: [{ delta: { content: 'The call was not run.' }, finish_reason: 'stop' }] }])
      return stream([{
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'web-fetch-checkpoint-failure-call',
              type: 'function',
              function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'https://fixture.invalid/report' }) },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      }])
    }

    const toolResults: string[] = []
    await agent.run('Retrieve the report.', {
      onToken() {},
      onToolCall() {},
      onToolResult(_name, result) { toolResults.push(result) },
      onDone() {},
    })

    expect(executorRuns).toBe(0)
    expect(modelRequests).toBe(2)
    expect(toolResults.some(result => result.includes('durable checkpoint unavailable'))).toBe(true)
    expect(failedCheckpoint).toBeDefined()
    const evidence = JSON.parse(failedCheckpoint!.find(message => message.name === 'deepseek_runtime_evidence_v1')?.content ?? '[]')
    const attempt = evidence.find((entry: { source: string }) => entry.source.startsWith('task-effect-attempt:'))
    expect(JSON.parse(attempt.text)).toMatchObject({
      schema: 'primary_task_effect_attempt_v1',
      toolCallId: 'web-fetch-checkpoint-failure-call',
      toolName: 'web_fetch',
      state: 'unknown',
      manualReviewRequired: true,
    })
    expect(failedCheckpoint!.some(message => message.role === 'tool' && message.tool_call_id === 'web-fetch-checkpoint-failure-call')).toBe(false)
  })

  it('checkpoints a read-only call before a matching PreToolUse hook can have effects', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-pre-hook-effects-'))
    const checkpointPath = join(root, 'checkpointed')
    const effectPath = join(root, 'pre-hook-effect')
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages) as Array<{ name?: string; content?: string }>
        checkpoints.push(snapshot)
        await writeFile(checkpointPath, 'saved')
      },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = {
      risk: { enabled: false },
      hooks: { PreToolUse: [{ matcher: 'read_file', hooks: [{ type: 'command', command: effectHookCommand(checkpointPath, effectPath) }] }] },
    }
    internal.allowedTools = '*'
    internal.executeTool = async () => 'read result'
    agent.setToolPermissionHandler(async () => 'once')

    await internal.checkAndExecuteTool({
      id: 'read-with-pre-hook', type: 'function', function: { name: 'read_file', arguments: '{"path":"source.txt"}' },
    }, { path: 'source.txt' }, callbacks())

    expect(await readFile(effectPath, 'utf8')).toBe('checkpointed')
    const attempt = evidenceFromCheckpoint(checkpoints[0]!).find(entry => entry.source.startsWith('task-effect-attempt:'))
    expect(JSON.parse(attempt?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_attempt_v1',
      toolCallId: 'read-with-pre-hook',
      toolName: 'read_file',
      state: 'unknown',
      manualReviewRequired: true,
    })

    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())
    const summary = evidenceFromCheckpoint(checkpoints.at(-1)!).find(entry => entry.source.startsWith('task-effect-reconciliation:'))
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({ state: 'unknown', manualReviewRequired: true })
  })

  it('does not run a stale PreToolUse hook after settings change during its checkpoint', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-settings-race-'))
    const checkpointPath = join(root, 'checkpointed')
    const staleEffectPath = join(root, 'stale-hook-effect')
    const replacementEffectPath = join(root, 'replacement-hook-effect')
    let internal: any
    let checkpoints = 0
    let executorRuns = 0
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async () => {
        checkpoints++
        await writeFile(checkpointPath, 'saved')
        internal.settings.hooks = { PreToolUse: [{ matcher: 'read_file', hooks: [{ type: 'command', command: runScript(`require('node:fs').writeFileSync(${JSON.stringify(replacementEffectPath)}, 'ran')`) }] }] }
      },
    })
    await agent.readyPromise

    internal = agent as any
    internal.settings = {
      risk: { enabled: false },
      hooks: { PreToolUse: [{ matcher: 'read_file', hooks: [{ type: 'command', command: effectHookCommand(checkpointPath, staleEffectPath) }] }] },
    }
    internal.allowedTools = '*'
    internal.executeTool = async () => { executorRuns++; return 'read result' }
    agent.setToolPermissionHandler(async () => 'once')
    const results: string[] = []

    await internal.checkAndExecuteTool({
      id: 'read-with-hook-settings-race', type: 'function', function: { name: 'read_file', arguments: '{"path":"source.txt"}' },
    }, { path: 'source.txt' }, {
      ...callbacks(),
      onToolResult(_name: string, result: string) { results.push(result) },
    })

    expect(checkpoints).toBe(1)
    expect(executorRuns).toBe(0)
    expect(results.join('\n')).toContain('AUTHORIZATION_CHANGED')
    await expect(readFile(staleEffectPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(replacementEffectPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists a read-only call attempt before matching PostToolUse and PostToolBatch hooks can have effects', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-post-hook-effects-'))
    const checkpointPath = join(root, 'checkpointed')
    const effectPath = join(root, 'post-hook-effect')
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages) as Array<{ name?: string; content?: string }>
        checkpoints.push(snapshot)
        await writeFile(checkpointPath, 'saved')
      },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = {
      risk: { enabled: false },
      hooks: {
        PostToolUse: [{ matcher: 'read_file', hooks: [{ type: 'command', command: effectHookCommand(checkpointPath, effectPath) }] }],
        PostToolBatch: [{ type: 'command', command: effectHookCommand(checkpointPath, effectPath) }],
      },
    }
    internal.allowedTools = '*'
    internal.executeTool = async () => {
      const attempt = evidenceFromCheckpoint(checkpoints[0]!).find(entry => entry.source.startsWith('task-effect-attempt:'))
      expect(JSON.parse(attempt?.text ?? '{}')).toMatchObject({
        schema: 'primary_task_effect_attempt_v1',
        toolCallId: 'read-with-post-hook',
        toolName: 'read_file',
        state: 'unknown',
        manualReviewRequired: true,
      })
      return 'read result'
    }
    agent.setToolPermissionHandler(async () => 'once')

    await internal.checkAndExecuteTool({
      id: 'read-with-post-hook', type: 'function', function: { name: 'read_file', arguments: '{"path":"source.txt"}' },
    }, { path: 'source.txt' }, callbacks())

    await internal.runPostToolBatchHooks([{ toolName: 'read_file' }])
    expect(await readFileEventually(effectPath)).toBe('checkpointed')
    internal.recordPrimaryTaskEffectReconciliation()
    await internal.options.checkpointHistory(internal.getRawMessages())
    const summary = evidenceFromCheckpoint(checkpoints.at(-1)!).find(entry => entry.source.startsWith('task-effect-reconciliation:'))
    expect(JSON.parse(summary?.text ?? '{}')).toMatchObject({ state: 'unknown', manualReviewRequired: true })
  })

  it('checkpoints a read-only call before a matching PermissionRequest hook can have effects', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-permission-hook-effects-'))
    const checkpointPath = join(root, 'checkpointed')
    const effectPath = join(root, 'permission-hook-effect')
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages) as Array<{ name?: string; content?: string }>
        checkpoints.push(snapshot)
        await writeFile(checkpointPath, 'saved')
      },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = {
      permissions: { allow: [], deny: [] },
      risk: { enabled: false },
      hooks: { PermissionRequest: [{ matcher: 'read_file', hooks: [{ type: 'command', command: effectHookCommand(checkpointPath, effectPath) }] }] },
    }
    internal.allowedTools = '*'
    internal.executeTool = async () => 'read result'
    agent.setToolPermissionHandler(async () => 'once')

    await internal.checkAndExecuteTool({
      id: 'read-with-permission-hook', type: 'function', function: { name: 'read_file', arguments: '{"path":"source.txt"}' },
    }, { path: 'source.txt' }, callbacks())

    expect(await readFile(effectPath, 'utf8')).toBe('checkpointed')
    const attempt = evidenceFromCheckpoint(checkpoints[0]!).find(entry => entry.source.startsWith('task-effect-attempt:'))
    expect(JSON.parse(attempt?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_attempt_v1',
      toolCallId: 'read-with-permission-hook',
      toolName: 'read_file',
      state: 'unknown',
      manualReviewRequired: true,
      hooksMayHaveEffects: true,
    })
  })

  it('checkpoints a malformed call before an enabled PostToolBatch hook can have effects', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-batch-hook-effects-'))
    const checkpointPath = join(root, 'checkpointed')
    const effectPath = join(root, 'post-batch-hook-effect')
    const checkpoints: Array<Array<any>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages) as Array<any>
        checkpoints.push(snapshot)
        if (evidenceFromCheckpoint(snapshot).some(entry => entry.source.startsWith('task-effect-attempt:'))) await writeFile(checkpointPath, 'saved')
      },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = {
      risk: { enabled: false },
      hooks: { PostToolBatch: [{ type: 'command', command: effectHookCommand(checkpointPath, effectPath) }] },
    }
    internal.fetchBalance = async () => undefined
    const stream = (chunks: object[]): AsyncIterable<object> => ({
      async *[Symbol.asyncIterator]() { yield* chunks },
    })
    let modelRequests = 0
    internal.openStream = async () => {
      modelRequests++
      if (modelRequests === 1) return stream([{
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'malformed-batch-hook-call', type: 'function', function: { name: 'read_file', arguments: '{' } }] },
          finish_reason: 'tool_calls',
        }],
      }])
      return stream([{ choices: [{ delta: { content: 'The malformed call was rejected.' }, finish_reason: 'stop' }] }])
    }

    await agent.run('Read the file.', {
      onToken() {},
      onToolCall() {},
      onToolResult() {},
      onDone() {},
    })

    expect(modelRequests).toBe(2)
    expect(await readFileEventually(effectPath)).toBe('checkpointed')
    const checkpointedAttempt = checkpoints.flatMap(snapshot => evidenceFromCheckpoint(snapshot)).find(entry => entry.source.startsWith('task-effect-attempt:'))
    expect(JSON.parse(checkpointedAttempt?.text ?? '{}')).toMatchObject({
      schema: 'primary_task_effect_attempt_v1',
      toolCallId: 'malformed-batch-hook-call',
      toolName: 'read_file',
      state: 'unknown',
      manualReviewRequired: true,
      hooksMayHaveEffects: true,
    })
  })

  it('does not run PostToolUseFailure when the effect checkpoint fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-failure-hook-checkpoint-'))
    const effectPath = join(root, 'post-failure-hook-effect')
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async () => { throw new Error('durable checkpoint unavailable') },
    })
    await agent.readyPromise

    const internal = agent as any
    internal.settings = {
      permissions: { allow: ['web_fetch'], deny: [] },
      risk: { enabled: false },
      hooks: { PostToolUseFailure: [{ matcher: 'web_fetch', hooks: [{ type: 'command', command: runScript(`require('node:fs').writeFileSync(${JSON.stringify(effectPath)}, 'ran')`) }] }] },
    }
    agent.setToolPermissionHandler(async () => 'once')
    await internal.checkAndExecuteTool({
      id: 'web-fetch-failure-hook-checkpoint', type: 'function', function: { name: 'web_fetch', arguments: '{"url":"https://fixture.invalid"}' },
    }, { url: 'https://fixture.invalid' }, callbacks())

    await expect(readFile(effectPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('durably brackets lifecycle hooks with metadata-only unknown markers', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-ledger-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(structuredClone(messages) as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise
    const internal = agent as any
    internal.settings.hooks = { UserPromptSubmit: [{ type: 'command', command: 'unused hook command' }] }

    const result = await internal.runPrimaryAgentLifecycleHook('UserPromptSubmit', async () => {
      expect(checkpoints).toHaveLength(1)
      const started = evidenceFromCheckpoint(checkpoints[0]!).find(entry => entry.source.startsWith('primary-agent-hook-effect:'))
      expect(JSON.parse(started?.text ?? '{}')).toMatchObject({
        schema: 'primary_agent_hook_effect_v1',
        event: 'UserPromptSubmit',
        phase: 'started',
        state: 'unknown',
        manualReviewRequired: true,
      })
      return 'hook result is not journal data'
    })

    expect(result).toBe('hook result is not journal data')
    expect(checkpoints).toHaveLength(2)
    const markers = evidenceFromCheckpoint(checkpoints[1]!).filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
    expect(markers.map(entry => JSON.parse(entry.text).phase)).toEqual(['started', 'finished'])
    expect(markers.map(entry => JSON.parse(entry.text).state)).toEqual(['unknown', 'unknown'])
    expect(JSON.stringify(markers)).not.toContain('unused hook command')
    expect(JSON.stringify(markers)).not.toContain('hook result is not journal data')
  })

  it('journals CwdChanged before running the hook during a directory change', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-cwd-hook-'))
    const target = join(root, 'target')
    const startMarkerPath = join(root, 'cwd-hook-started')
    const hookEffectPath = join(root, 'cwd-hook-effect.json')
    await mkdir(target)
    const fakeHome = join(root, 'home')
    await mkdir(join(fakeHome, '.deepseek'), { recursive: true })
    const hookCommand = runScript(`
      const fs = require('node:fs')
      const input = JSON.parse(fs.readFileSync(0, 'utf8'))
      fs.writeFileSync(${JSON.stringify(hookEffectPath)}, JSON.stringify({
        checkpointed: fs.existsSync(${JSON.stringify(startMarkerPath)}),
        event: input.event,
        cwd: input.cwd,
      }))
    `)
    await writeFile(join(fakeHome, '.deepseek', 'settings.json'), JSON.stringify({
      hooks: { CwdChanged: [{ type: 'command', command: hookCommand }] },
    }))
    const checkpoints: MessageOrBoundary[][] = []
    const homedirSpy = spyOn(os, 'homedir').mockReturnValue(fakeHome)
    try {
      agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
        projectRoot: root,
        logFile: null,
        snapshotFile: null,
        checkpointHistory: async messages => {
          const snapshot = structuredClone(messages)
          checkpoints.push(snapshot)
          const started = evidenceFromCheckpoint(snapshot).some(entry => entry.source.startsWith('primary-agent-hook-effect:') &&
            JSON.parse(entry.text).event === 'CwdChanged' && JSON.parse(entry.text).phase === 'started')
          if (started) await writeFile(startMarkerPath, 'checkpointed')
        },
      })
      await agent.readyPromise
      await agent.setWorkingDirectory(target)

      expect(agent.getWorkingDirectory()).toBe(target)
      expect(JSON.parse(await readFile(hookEffectPath, 'utf8'))).toEqual({ checkpointed: true, event: 'CwdChanged', cwd: target })
      const markers = evidenceFromCheckpoint(checkpoints.at(-1)!).filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
      expect(markers.map(entry => JSON.parse(entry.text).phase)).toEqual(['started', 'finished'])
      expect(markers.map(entry => JSON.parse(entry.text).event)).toEqual(['CwdChanged', 'CwdChanged'])
      expect(new Set(markers.map(entry => JSON.parse(entry.text).operationId)).size).toBe(1)
      expect(markers.every(entry => JSON.parse(entry.text).state === 'unknown' && JSON.parse(entry.text).manualReviewRequired)).toBe(true)
      expect(JSON.stringify(markers)).not.toContain(hookEffectPath)
    } finally {
      homedirSpy.mockRestore()
    }
  })

  it('does not run a lifecycle hook when its start marker cannot be checkpointed', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-start-failure-'))
    let attempted: Array<{ name?: string; content?: string }> | undefined
    let hookRuns = 0
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        attempted = structuredClone(messages) as Array<{ name?: string; content?: string }>
        throw new Error('hook start checkpoint unavailable')
      },
    })
    await agent.readyPromise
    const internal = agent as any
    internal.settings.hooks = { MessageDisplay: [{ type: 'command', command: 'unused hook command' }] }

    await expect(internal.runPrimaryAgentLifecycleHook('MessageDisplay', async () => { hookRuns++ }))
      .rejects.toThrow('hook start checkpoint unavailable')

    expect(hookRuns).toBe(0)
    const markers = evidenceFromCheckpoint(attempted!).filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
    expect(markers.map(entry => JSON.parse(entry.text))).toMatchObject([{
      schema: 'primary_agent_hook_effect_v1',
      event: 'MessageDisplay',
      phase: 'started',
      state: 'unknown',
      manualReviewRequired: true,
    }])
  })

  it('records a settled lifecycle hook as unknown even when its runner throws', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-finish-failure-'))
    const checkpoints: MessageOrBoundary[][] = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(structuredClone(messages)) },
    })
    await agent.readyPromise
    const internal = agent as any
    internal.settings.hooks = { Stop: [{ type: 'command', command: 'unused hook command' }] }
    const failure = new Error('hook runner failed')

    await expect(internal.runPrimaryAgentLifecycleHook('Stop', async () => { throw failure })).rejects.toBe(failure)

    expect(checkpoints).toHaveLength(2)
    expect(evidenceFromCheckpoint(checkpoints[1]!).filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
      .map(entry => JSON.parse(entry.text).phase)).toEqual(['started', 'finished'])
  })

  it('keeps lifecycle hooks best-effort when no durable history callback exists', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-no-checkpoint-'))
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
    })
    await agent.readyPromise
    const internal = agent as any
    internal.settings.hooks = { UserPromptSubmit: [{ type: 'command', command: 'unused hook command' }] }
    let hookRuns = 0

    await expect(internal.runPrimaryAgentLifecycleHook('UserPromptSubmit', async () => { hookRuns++ })).resolves.toBeUndefined()

    expect(hookRuns).toBe(1)
    expect(internal.sessionEvidence.toolSources().some((entry: { source: string }) => entry.source.startsWith('primary-agent-hook-effect:'))).toBe(false)
  })

  it('recovers an unmatched lifecycle start without a tool call and never replays it', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-recovery-'))
    const effectPath = join(root, 'must-not-replay')
    const checkpoints: MessageOrBoundary[][] = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(structuredClone(messages)) },
    })
    await agent.readyPromise
    const internal = agent as any
    internal.settings.hooks = { UserPromptSubmit: [{ type: 'command', command: runScript(`require('node:fs').writeFileSync(${JSON.stringify(effectPath)}, 'ran')`) }] }
    const operationId = '4cc70400-fcc8-4ebf-9c4a-0f8c5a547b46'
    internal.recordPrimaryAgentHookEffect(operationId, 'UserPromptSubmit', 'started')

    await agent.loadSessionMessages(agent.getRawMessages(), true)

    expect(checkpoints).toHaveLength(1)
    const recoveredMarkers = evidenceFromCheckpoint(checkpoints[0]!).filter(entry => entry.source === `primary-agent-hook-effect:${operationId}`)
    expect(recoveredMarkers.map(entry => JSON.parse(entry.text).phase)).toEqual(['started', 'recovered'])
    expect(recoveredMarkers.every(entry => JSON.parse(entry.text).state === 'unknown')).toBe(true)
    expect(JSON.stringify(agent.getMessages())).toContain('Lifecycle hook UserPromptSubmit has unknown effects')
    expect(JSON.stringify(agent.getMessages())).toContain('must not be replayed')
    await expect(readFile(effectPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await agent.loadSessionMessages(checkpoints[0]!, true)
    expect(checkpoints).toHaveLength(1)
    expect(evidenceFromCheckpoint(agent.getRawMessages()).filter(entry => entry.source === `primary-agent-hook-effect:${operationId}`))
      .toHaveLength(2)
  })

  it('records malformed lifecycle markers as unknown without copying their payload', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-malformed-recovery-'))
    const checkpoints: MessageOrBoundary[][] = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(structuredClone(messages)) },
    })
    await agent.readyPromise
    const internal = agent as any
    const malformedPayload = JSON.stringify({ schema: 'primary_agent_hook_effect_v1', payload: 'must-not-be-copied' })
    const malformedEvidenceId = internal.sessionEvidence.add('tool', 'primary-agent-hook-effect:not-a-uuid', malformedPayload)

    await agent.loadSessionMessages(agent.getRawMessages(), true)

    expect(checkpoints).toHaveLength(1)
    const recovery = evidenceFromCheckpoint(checkpoints[0]!).find(entry => entry.source === `primary-agent-hook-effect-recovery:${malformedEvidenceId}`)
    expect(JSON.parse(recovery?.text ?? '{}')).toEqual({
      schema: 'primary_agent_hook_effect_recovery_v1',
      malformedEvidenceId,
      event: 'unknown',
      state: 'unknown',
      manualReviewRequired: true,
    })
    expect(recovery?.text).not.toContain('must-not-be-copied')
    expect(JSON.stringify(agent.getMessages())).toContain('Lifecycle hook unknown has unknown effects')
    expect(JSON.stringify(agent.getMessages())).toContain('must not be replayed')

    await agent.loadSessionMessages(checkpoints[0]!, true)
    expect(checkpoints).toHaveLength(1)
    expect(evidenceFromCheckpoint(agent.getRawMessages()).filter(entry => entry.source === `primary-agent-hook-effect-recovery:${malformedEvidenceId}`))
      .toHaveLength(1)
  })

  it('blocks resume when malformed lifecycle evidence cannot be durably reconciled', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-malformed-checkpoint-failure-'))
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
    })
    await agent.readyPromise
    const internal = agent as any
    internal.sessionEvidence.add('tool', 'primary-agent-hook-effect:invalid-marker', '{not-json')

    await expect(agent.loadSessionMessages(agent.getRawMessages(), true))
      .rejects.toThrow('Interrupted primary task effects were recovered but cannot be durably saved')
    expect(internal.sessionRecoveryBlocked).toBeInstanceOf(Error)
    expect(JSON.stringify(agent.getMessages())).toContain('Lifecycle hook unknown has unknown effects')
  })

  it('runs prompt, stop, and display lifecycle hooks through the durable ledger', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-hook-call-sites-'))
    const checkpoints: Array<Array<{ name?: string; content?: string }>> = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(structuredClone(messages) as Array<{ name?: string; content?: string }>) },
    })
    await agent.readyPromise
    const internal = agent as any
    const noOp = runScript('process.exit(0)')
    internal.settings = {
      permissions: { allow: [], deny: [] },
      risk: { enabled: false },
      hooks: {
        UserPromptSubmit: [{ type: 'command', command: noOp }],
        UserPromptExpansion: [{ matcher: 'prompt', hooks: [{ type: 'command', command: noOp }] }],
        Stop: [{ type: 'command', command: noOp }],
        MessageDisplay: [{ type: 'command', command: noOp }],
      },
    }
    internal.fetchBalance = async () => undefined
    internal.openStream = async () => ({ async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: 'A stable answer.' }, finish_reason: 'stop' }] }
    } })

    await agent.run('A stable prompt.', callbacks())

    const markers = evidenceFromCheckpoint(checkpoints.at(-1)!).filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
      .map(entry => JSON.parse(entry.text) as { event: string; phase: string; state: string })
    expect(new Set(markers.map(marker => marker.event))).toEqual(new Set([
      'UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'MessageDisplay',
    ]))
    for (const event of ['UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'MessageDisplay']) {
      expect(markers.filter(marker => marker.event === event).map(marker => marker.phase)).toEqual(['started', 'finished'])
    }
    expect(markers.every(marker => marker.state === 'unknown')).toBe(true)
    expect(JSON.stringify(markers)).not.toContain('A stable prompt.')
    expect(JSON.stringify(markers)).not.toContain('A stable answer.')
    expect(JSON.stringify(markers)).not.toContain(noOp)
  })

  it('checkpoints the compacted transcript before PostCompact can run', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-primary-post-compact-hook-'))
    const previousHistoryPath = process.env.DEEPSEEK_HISTORY_PATH
    process.env.DEEPSEEK_HISTORY_PATH = join(root, 'history.json')
    const checkpoints: MessageOrBoundary[][] = []
    const preHookStatePath = join(root, 'pre-hook-state.json')
    const preEffectPath = join(root, 'pre-hook-effect')
    const postHookStatePath = join(root, 'post-hook-state.json')
    const postEffectPath = join(root, 'post-hook-effect')
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const snapshot = structuredClone(messages)
        checkpoints.push(snapshot)
        const markers = evidenceFromCheckpoint(snapshot).filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
        if (markers.some(entry => JSON.parse(entry.text).event === 'PreCompact' && JSON.parse(entry.text).phase === 'started')) {
          await writeFile(preHookStatePath, JSON.stringify(snapshot))
        }
        if (markers.some(entry => JSON.parse(entry.text).event === 'PostCompact' && JSON.parse(entry.text).phase === 'started')) {
          await writeFile(postHookStatePath, JSON.stringify(snapshot))
        }
      },
    })
    try {
      await agent.readyPromise
      const internal = agent as any
      const preCommand = runScript(`const fs = require('node:fs'); const saved = JSON.parse(fs.readFileSync(${JSON.stringify(preHookStatePath)}, 'utf8')); const compacted = saved.some(message => message.role === 'assistant' && String(message.content).startsWith('[Compacted context]')); fs.writeFileSync(${JSON.stringify(preEffectPath)}, compacted ? 'already compacted' : 'before compaction')`)
      const postCommand = runScript(`const fs = require('node:fs'); const saved = JSON.parse(fs.readFileSync(${JSON.stringify(postHookStatePath)}, 'utf8')); const compacted = saved.some(message => message.role === 'assistant' && String(message.content).startsWith('[Compacted context]')); fs.writeFileSync(${JSON.stringify(postEffectPath)}, compacted ? 'compacted' : 'stale')`)
      internal.settings.hooks = {
        PreCompact: [{ matcher: 'manual', hooks: [{ type: 'command', command: preCommand }] }],
        PostCompact: [{ matcher: 'manual', hooks: [{ type: 'command', command: postCommand }] }],
      }
      internal.messages.push({ role: 'user', content: 'Conversation before compaction.' })
      internal.createProviderCompletion = async () => ({
        choices: [{ message: { content: Array.from({ length: 9 }, (_, index) => `## ${index + 1}. Section\nA concise compacted summary.`).join('\n') } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      await agent.compact('manual')

      expect(await readFile(preEffectPath, 'utf8')).toBe('before compaction')
      expect(await readFile(postEffectPath, 'utf8')).toBe('compacted')
      const postStart = checkpoints.flatMap(snapshot => evidenceFromCheckpoint(snapshot))
        .find(entry => entry.source.startsWith('primary-agent-hook-effect:') && JSON.parse(entry.text).event === 'PostCompact')
      expect(postStart).toBeDefined()
    } finally {
      if (previousHistoryPath === undefined) delete process.env.DEEPSEEK_HISTORY_PATH
      else process.env.DEEPSEEK_HISTORY_PATH = previousHistoryPath
    }
  })

  it('preserves the original provider error when StopFailure journaling fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-stop-failure-original-error-'))
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => {
        const marker = evidenceFromCheckpoint(messages as Array<{ name?: string; content?: string }>)
          .find(entry => entry.source.startsWith('primary-agent-hook-effect:'))
        if (marker) throw new Error('StopFailure checkpoint unavailable')
      },
    })
    await agent.readyPromise
    const internal = agent as any
    internal.settings = {
      permissions: { allow: [], deny: [] },
      risk: { enabled: false },
      hooks: { StopFailure: [{ matcher: 'unknown', hooks: [{ type: 'command', command: 'unused hook command' }] }] },
    }
    internal.openStream = async () => { throw new Error('provider connection failed') }

    await expect(agent.run('Trigger a provider failure.', callbacks())).rejects.toThrow('provider connection failed')
  })

  it('aborts StopFailure hook child effects while preserving the provider error and journal', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepseek-stop-failure-abort-'))
    const startedPath = join(root, 'stop-failure-started')
    const effectPath = join(root, 'stop-failure-effect')
    const effectDelayMs = 6_000
    const checkpoints: MessageOrBoundary[][] = []
    agent = new Agent({ provider: 'local', localModel: 'test-model' }, {
      projectRoot: root,
      logFile: null,
      snapshotFile: null,
      checkpointHistory: async messages => { checkpoints.push(structuredClone(messages)) },
    })
    await agent.readyPromise
    const internal = agent as any
    const hookCommand = runScript(`const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(startedPath)}, JSON.stringify({ pid: process.pid, ppid: process.ppid })); setTimeout(() => fs.writeFileSync(${JSON.stringify(effectPath)}, 'continued'), ${effectDelayMs})`)
    internal.settings = {
      permissions: { allow: [], deny: [] },
      risk: { enabled: false },
      hooks: { StopFailure: [{ matcher: 'unknown', hooks: [{ type: 'command', command: hookCommand }] }] },
    }
    internal.openStream = async () => { throw new Error('provider connection failed') }

    const runPromise = agent.run('Trigger a provider failure.', callbacks())
    console.error(`[hook-cancel] child ${await readFileEventually(startedPath)}`)
    const effectDeadline = Date.now() + effectDelayMs + 100
    const previousTrace = process.env.DEEPSEEK_PROCESS_KILL_TRACE
    process.env.DEEPSEEK_PROCESS_KILL_TRACE = '1'
    try {
      agent.abort()
      await expect(runPromise).rejects.toThrow('provider connection failed')
    } finally {
      if (previousTrace === undefined) delete process.env.DEEPSEEK_PROCESS_KILL_TRACE
      else process.env.DEEPSEEK_PROCESS_KILL_TRACE = previousTrace
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(0, effectDeadline - Date.now())))
    await expect(readFile(effectPath, 'utf8')).rejects.toThrow()

    const latestMarkers = evidenceFromCheckpoint(checkpoints.at(-1)!)
      .filter(entry => entry.source.startsWith('primary-agent-hook-effect:'))
      .map(entry => JSON.parse(entry.text) as { event: string; phase: string })
      .filter(entry => entry.event === 'StopFailure')
    expect(latestMarkers.map(entry => entry.phase)).toEqual(['started', 'finished'])
  })
})
