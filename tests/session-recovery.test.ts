import { expect, it } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Agent, type AgentOptions } from '../src/agent/agent.js'
import { createFileCheckpoint, listFileCheckpoints, markFileCheckpointWritten } from '../src/agent/fileCheckpoint.js'
import { SessionEvidence, toolReplayArgsDigest } from '../src/agent/sessionEvidence.js'
import { redactSecrets } from '../src/orchestration/events.js'
import { approvalKey } from '../src/permissions/matcher.js'
import { removeTempDirectory } from './helpers/removeTempDirectory.js'

function fileArgsDigest(args: Record<string, unknown>): string {
  const serialized = JSON.stringify(redactSecrets(args))
  if (!serialized) throw new Error('Unable to serialize fixture arguments')
  return createHash('sha256').update(serialized).digest('hex')
}

async function withAgent(run: (agent: Agent) => Promise<void>, sessionId?: string, options: Pick<AgentOptions, 'checkpointHistory'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-session-recovery-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null, sessionId, ...options })
  try {
    await agent.readyPromise
    await run(agent)
  } finally {
    await agent.shutdown()
    await removeTempDirectory(root)
  }
}

async function createVerifiedFileCheckpoint(agent: Agent, path: string, content = 'after') {
  const previousHome = process.env.HOME
  process.env.HOME = agent.getWorkingDirectory()
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'before')
    const sessionId = (agent as any).checkpointSessionId as string
    const checkpointId = await createFileCheckpoint(sessionId, path, 'write_file')
    await writeFile(path, content)
    const postVersion = { exists: true, hash: createHash('sha256').update(content).digest('hex') }
    await markFileCheckpointWritten(sessionId, checkpointId, postVersion)
    return { checkpointId, postVersion, entries: await listFileCheckpoints(sessionId) }
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  }
}

async function withHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    return await run()
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  }
}

const silentCallbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }

function readCall(id: string, args: Record<string, unknown>) {
  return { id, type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify(args) } }
}

async function recoverInterruptedRead(agent: Agent, callId: string, args: Record<string, unknown>): Promise<void> {
  await agent.loadSessionMessages([
    { role: 'system', content: (agent as any).systemPrompt },
    { role: 'assistant', content: null, tool_calls: [readCall(callId, args)] },
  ], true)
}

function installReadExecutor(agent: Agent, execute: () => Promise<string>): void {
  const internal = agent as any
  const tool = internal.toolMap.get('read_file')
  internal.toolMap.set('read_file', { ...tool, execute })
}

function grantOrdinaryReadApproval(agent: Agent, args: Record<string, unknown>): void {
  const internal = agent as any
  internal.settings = { permissions: { allow: ['read_file'], deny: [], autoApproveLowRisk: true }, risk: { enabled: false } }
  internal.sessionApprovedTools.add(approvalKey('read_file', args))
}

it('requires fresh one-call confirmation for an exact replay despite existing grants and auto-approval', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const args = { path: 'already-read.txt' }
    await recoverInterruptedRead(agent, 'lost-read-call', args)
    grantOrdinaryReadApproval(agent, args)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'read result' })
    const requests: Array<{ toolName: string; reason: string }> = []
    agent.setToolPermissionHandler(async request => { requests.push(request); return 'reject' })

    const result = await internal.checkAndExecuteTool(readCall('new-read-call-id', args), args, silentCallbacks)

    expect(requests.map(request => request.reason)).toEqual(['interrupted_replay'])
    expect(executions).toBe(0)
    expect(JSON.parse(result.result)).toMatchObject({ status: 'error', error: { code: 'USER_DENIED' } })
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(true)
  })
})

it('revalidates authorization after an interrupted replay confirmation opens', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const args = { path: 'authorization-changed.txt' }
    await recoverInterruptedRead(agent, 'lost-read-auth-change', args)
    grantOrdinaryReadApproval(agent, args)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'read result' })
    agent.setToolPermissionHandler(async () => {
      internal.settings.permissions.deny = ['read_file']
      return 'once'
    })

    const result = await internal.checkAndExecuteTool(readCall('read-after-policy-change', args), args, silentCallbacks)

    expect(JSON.parse(result.result)).toMatchObject({ status: 'error', error: { code: 'AUTHORIZATION_CHANGED' } })
    expect(executions).toBe(0)
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(true)
  })
})

it('does not retain one-call replay approval when the objective is superseded during policy refresh', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const args = { path: 'objective-changed-during-refresh.txt' }
    const call = readCall('objective-changed-during-refresh', args)
    await recoverInterruptedRead(agent, 'lost-read-objective-refresh', args)
    grantOrdinaryReadApproval(agent, args)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'read result' })
    let refreshes = 0
    internal.refreshAuthorizationSettings = async () => {
      refreshes++
      if (refreshes === 3) internal.objectiveRevision++
      return false
    }
    agent.setToolPermissionHandler(async () => 'once')

    const result = await internal.checkAndExecuteTool(call, args, silentCallbacks)

    expect(refreshes).toBe(3)
    expect(JSON.parse(result.result)).toMatchObject({ status: 'error', error: { code: 'OBJECTIVE_SUPERSEDED' } })
    expect(executions).toBe(0)
    expect(internal.approvedInterruptedReplays.has(call.id)).toBe(false)
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(true)
  })
})

it('does not retain one-call replay approval when cancellation arrives during policy refresh', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const args = { path: 'cancelled-during-refresh.txt' }
    const call = readCall('cancelled-during-refresh', args)
    await recoverInterruptedRead(agent, 'lost-read-cancel-refresh', args)
    grantOrdinaryReadApproval(agent, args)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'read result' })
    const controller = new AbortController()
    internal.abortController = controller
    let refreshes = 0
    internal.refreshAuthorizationSettings = async () => {
      refreshes++
      if (refreshes === 3) controller.abort()
      return false
    }
    agent.setToolPermissionHandler(async () => 'once')

    const result = await internal.checkAndExecuteTool(call, args, silentCallbacks)

    expect(refreshes).toBe(3)
    expect(JSON.parse(result.result)).toMatchObject({ status: 'error', error: { code: 'CANCELLED' } })
    expect(executions).toBe(0)
    expect(internal.approvedInterruptedReplays.has(call.id)).toBe(false)
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(true)
  })
})

it('rechecks project instructions after the interrupted replay authorization refresh', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const root = agent.getWorkingDirectory()
    const args = { path: join(root, 'new-file.ts'), content: 'export const value = 1' }
    const lostCall = { id: 'lost-write-during-refresh', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify(args) } }
    const call = { id: 'approved-write-during-refresh', type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify(args) } }
    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [lostCall] },
    ], true)
    internal.settings = {
      permissions: { allow: ['write_file'], deny: [], autoApproveLowRisk: true },
      risk: { enabled: false },
      git: { checkpoint: false },
    }
    internal.sessionApprovedTools.add(approvalKey('write_file', args))
    let executions = 0
    internal.executeTool = async () => { executions++; return 'write executed' }
    let releaseRefresh!: () => void
    let markRefreshStarted!: () => void
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve })
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve })
    let refreshes = 0
    internal.refreshAuthorizationSettings = async () => {
      refreshes++
      if (refreshes === 3) {
        markRefreshStarted()
        await refreshGate
      }
      return false
    }
    agent.setToolPermissionHandler(async () => 'once')

    const pending = internal.checkAndExecuteTool(call, args, silentCallbacks)
    await refreshStarted
    await writeFile(join(root, 'AGENTS.md'), 'Do not write files until this instruction is reviewed.')
    releaseRefresh()
    const result = await pending

    expect(refreshes).toBe(3)
    expect(JSON.parse(result.result)).toMatchObject({ status: 'error', error: { code: 'PROJECT_INSTRUCTIONS_CHANGED' } })
    expect(executions).toBe(0)
    expect(internal.approvedInterruptedReplays.has(call.id)).toBe(false)
    expect(internal.sessionEvidence.hasPendingToolReplay('write_file', toolReplayArgsDigest(args))).toBe(true)
  })
})

it('rechecks shell workspace inputs after the interrupted replay authorization refresh', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const root = agent.getWorkingDirectory()
    const scriptPath = join(root, 'script.ts')
    await writeFile(scriptPath, 'console.log("before")')
    const args = { command: 'bun script.ts' }
    const lostCall = { id: 'lost-shell-input-during-refresh', type: 'function' as const, function: { name: 'shell', arguments: JSON.stringify(args) } }
    const call = { id: 'approved-shell-input-during-refresh', type: 'function' as const, function: { name: 'shell', arguments: JSON.stringify(args) } }
    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [lostCall] },
    ], true)
    internal.settings = {
      permissions: { allow: ['shell'], deny: [], autoApproveLowRisk: true },
      risk: { enabled: false },
    }
    let executions = 0
    internal.executeTool = async () => { executions++; return 'shell executed' }
    let releaseRefresh!: () => void
    let markRefreshStarted!: () => void
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve })
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve })
    let refreshes = 0
    internal.refreshAuthorizationSettings = async () => {
      refreshes++
      if (refreshes === 3) {
        markRefreshStarted()
        await refreshGate
      }
      return false
    }
    agent.setToolPermissionHandler(async () => 'once')

    const pending = internal.checkAndExecuteTool(call, args, silentCallbacks)
    await refreshStarted
    try {
      await writeFile(scriptPath, 'console.log("after")')
    } finally {
      releaseRefresh()
    }
    const result = await pending

    expect(refreshes).toBe(3)
    expect(JSON.parse(result.result)).toMatchObject({ status: 'error', error: { code: 'SHELL_INPUT_CHANGED' } })
    expect(executions).toBe(0)
    expect(internal.approvedInterruptedReplays.has(call.id)).toBe(false)
    expect(internal.sessionEvidence.hasPendingToolReplay('shell', toolReplayArgsDigest(args))).toBe(true)
  })
})

it('executes an approved interrupted replay once and clears its guard only with the saved result', async () => {
  const checkpoints: any[][] = []
  await withAgent(async agent => {
    const internal = agent as any
    const args = { path: 'retry-once.txt' }
    await recoverInterruptedRead(agent, 'lost-read-once', args)
    grantOrdinaryReadApproval(agent, args)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'read result' })
    const requests: Array<{ toolName: string; reason: string }> = []
    agent.setToolPermissionHandler(async request => { requests.push(request); return 'once' })

    const call = readCall('approved-read-call', args)
    const result = await internal.checkAndExecuteTool(call, args, silentCallbacks)
    expect(executions).toBe(1)
    expect(requests.map(request => request.reason)).toEqual(['interrupted_replay'])
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(true)

    internal.messages.push({ role: 'assistant', content: null, tool_calls: [call] })
    internal.messages.push({ role: 'tool', tool_call_id: call.id, content: result.result })
    await internal.persistApprovedInterruptedReplays([call.id])

    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(false)
    const savedEvidence = checkpoints.at(-1)!.find(message => message.role === 'system' && message.name === 'deepseek_runtime_evidence_v1')
    expect(JSON.parse(savedEvidence.content).some((entry: { kind: string }) => entry.kind === 'pending_replay')).toBe(false)
    expect(checkpoints.at(-1)).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: call.id, content: 'read result' }))
  }, undefined, { checkpointHistory: async messages => { checkpoints.push(structuredClone(messages)) } })
})

it('leaves the replay guard in place when the result checkpoint fails and asks again', async () => {
  const checkpoints: any[][] = []
  let writes = 0
  await withAgent(async agent => {
    const internal = agent as any
    const args = { path: 'retry-after-crash.txt' }
    await recoverInterruptedRead(agent, 'lost-read-after-crash', args)
    grantOrdinaryReadApproval(agent, args)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'read result' })
    const requests: Array<{ toolName: string; reason: string }> = []
    agent.setToolPermissionHandler(async request => {
      requests.push(request)
      return requests.length === 1 ? 'once' : 'reject'
    })

    const first = readCall('approved-but-unsaved-read', args)
    const result = await internal.checkAndExecuteTool(first, args, silentCallbacks)
    internal.messages.push({ role: 'assistant', content: null, tool_calls: [first] })
    internal.messages.push({ role: 'tool', tool_call_id: first.id, content: result.result })
    await expect(internal.persistApprovedInterruptedReplays([first.id])).rejects.toThrow('checkpoint failed')
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(args))).toBe(true)

    await internal.checkAndExecuteTool(readCall('retry-after-unsaved-result', args), args, silentCallbacks)
    expect(requests.map(request => request.reason)).toEqual(['interrupted_replay', 'interrupted_replay'])
    expect(executions).toBe(1)
  }, undefined, { checkpointHistory: async messages => {
    writes++
    if (writes === 2) throw new Error('checkpoint failed')
    checkpoints.push(structuredClone(messages))
  } })
})

it('allows a different call through while retaining the interrupted-call guard', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const interruptedArgs = { path: 'lost.txt' }
    const differentArgs = { path: 'other.txt' }
    await recoverInterruptedRead(agent, 'lost-read-different', interruptedArgs)
    grantOrdinaryReadApproval(agent, differentArgs)
    let executions = 0
    installReadExecutor(agent, async () => { executions++; return 'other result' })
    const requests: unknown[] = []
    agent.setToolPermissionHandler(async request => { requests.push(request); return 'once' })

    const result = await internal.checkAndExecuteTool(readCall('unrelated-read-call', differentArgs), differentArgs, silentCallbacks)

    expect(result.result).toBe('other result')
    expect(executions).toBe(1)
    expect(requests).toEqual([])
    expect(internal.sessionEvidence.hasPendingToolReplay('read_file', toolReplayArgsDigest(interruptedArgs))).toBe(true)
  })
})

it('repairs only missing native tool results and marks their outcomes unknown', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      {
        role: 'assistant', content: null, tool_calls: [
          { id: 'finished-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"done.txt"}' } },
          { id: 'interrupted-call', type: 'function', function: { name: 'shell', arguments: '{"command":"write something"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'finished-call', content: 'Existing result' },
    ], true)

    const messages = agent.getMessages()
    expect(messages.filter(message => message.role === 'tool')).toEqual([
      { role: 'tool', tool_call_id: 'finished-call', content: 'Existing result' },
      expect.objectContaining({ role: 'tool', tool_call_id: 'interrupted-call' }),
    ])
    const recovered = messages.find(message => message.role === 'tool' && message.tool_call_id === 'interrupted-call')
    expect(String(recovered?.content)).toContain('may have executed')
    expect(String(recovered?.content)).toContain('Do not replay')
    expect(String(messages.find(message => message.role === 'user' && String(message.content).includes('<resume-state>'))?.content)).toContain('unknown outcomes')
  })
})

it('recovers a committed primary file receipt without reconciling another interrupted effect', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const callId = 'committed-write-call'
    const filePath = join(agent.getWorkingDirectory(), 'report.txt')
    const args = { path: filePath, content: 'report' }
    const checkpoint = await createVerifiedFileCheckpoint(agent, filePath, args.content)
    const evidence = new SessionEvidence()
    evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: fileArgsDigest(args),
      requestedPath: filePath,
      checkpointId: checkpoint.checkpointId,
      path: filePath,
      postVersion: checkpoint.postVersion,
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      {
        role: 'assistant', content: null, tool_calls: [
          { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
          { id: 'unresolved-shell-call', type: 'function', function: { name: 'shell', arguments: '{"command":"publish report"}' } },
        ],
      },
      evidence.snapshot(),
    ], true, undefined, checkpoint.entries)

    const messages = agent.getMessages()
    const recoveredWrite = messages.find(message => message.role === 'tool' && message.tool_call_id === callId)
    const recoveredShell = messages.find(message => message.role === 'tool' && message.tool_call_id === 'unresolved-shell-call')
    const writeResult = String(recoveredWrite?.content)
    const shellResult = String(recoveredShell?.content)

    expect(writeResult).toContain('effect-observed')
    expect(writeResult).toContain(filePath)
    expect(writeResult).toContain(checkpoint.postVersion.hash)
    expect(writeResult).toMatch(/Do not replay(?: it)? automatically/i)
    expect(shellResult).toContain('may have executed')
    expect(shellResult).toMatch(/Do not replay(?: it)? automatically/i)
    expect(shellResult).not.toContain('effect-observed')
  })
})

it('recovers primary file receipts for native Bedrock V3.1 and V3.2 call IDs', async () => {
  for (const model of ['us.deepseek.v3.1-v1:0', 'us.deepseek.v3.2-v1:0']) {
    await withAgent(async agent => {
      const internal = agent as any
      internal.provider = 'bedrock'
      agent.model = model as any
      const callId = `committed-${model.includes('3.1') ? 'v31' : 'v32'}-call`
      const filePath = join(agent.getWorkingDirectory(), 'native-bedrock-report.txt')
      const args = { path: filePath, content: 'report' }
      const checkpoint = await createVerifiedFileCheckpoint(agent, filePath, args.content)
      const evidence = new SessionEvidence()
      evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
        state: 'effect-observed',
        effectId: callId,
        toolCallId: callId,
        toolName: 'write_file',
        argsDigest: fileArgsDigest(args),
        requestedPath: filePath,
        checkpointId: checkpoint.checkpointId,
        path: filePath,
        postVersion: checkpoint.postVersion,
      }))

      await agent.loadSessionMessages([
        { role: 'system', content: internal.systemPrompt },
        { role: 'assistant', content: null, tool_calls: [
          { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
        ] },
        evidence.snapshot(),
      ], true, { provider: 'bedrock', model }, checkpoint.entries)

      const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
      expect(recovered).toContain('effect-observed')
      expect(recovered).toContain(filePath)
      expect(recovered).toContain(checkpoint.postVersion.hash)
      expect(recovered).toContain('Do not replay it automatically')
    })
  }
})

it('recovers native Bedrock receipts after reopening a saved V3 session with R1 selected', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    internal.provider = 'bedrock'
    agent.model = 'us.deepseek.r1-v1:0' as any
    const callId = 'saved-v32-current-r1-call'
    const filePath = join(agent.getWorkingDirectory(), 'saved-bedrock-report.txt')
    const args = { path: filePath, content: 'report' }
    const checkpoint = await createVerifiedFileCheckpoint(agent, filePath, args.content)
    const evidence = new SessionEvidence()
    evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: fileArgsDigest(args),
      requestedPath: filePath,
      checkpointId: checkpoint.checkpointId,
      path: filePath,
      postVersion: checkpoint.postVersion,
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
      ] },
      evidence.snapshot(),
    ], true, { provider: 'bedrock', model: 'us.deepseek.v3.2-v1:0' }, checkpoint.entries)

    const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(recovered).toContain('effect-observed')
    expect(recovered).toContain(filePath)
    expect(recovered).toContain(checkpoint.postVersion.hash)
    expect(recovered).toContain('Do not replay it automatically')
  })
})

it('keeps Bedrock R1 prompt-emulated interruptions generic when receipt-shaped evidence exists', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    internal.provider = 'bedrock'
    agent.model = 'us.deepseek.r1-v1:0' as any
    const evidence = new SessionEvidence()
    evidence.add('tool', 'file-effect-outcome:bedrock-r1-call', JSON.stringify({
      state: 'effect-observed',
      effectId: 'bedrock-r1-call',
      toolCallId: 'bedrock-r1-call',
      toolName: 'write_file',
      argsDigest: fileArgsDigest({ path: '/workspace/r1-report.txt', content: 'report' }),
      requestedPath: '/workspace/r1-report.txt',
      checkpointId: 'checkpoint-r1-call',
      path: '/workspace/r1-report.txt',
      postVersion: { exists: true, hash: 'e'.repeat(64) },
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: '<tool_call><name>write_file</name><args>{"path":"/workspace/r1-report.txt","content":"report"}</args></tool_call>' },
      evidence.snapshot(),
    ], true, { provider: 'bedrock', model: 'us.deepseek.r1-v1:0' })

    const recovery = String(agent.getMessages().find(message => message.role === 'user' && String(message.content).includes('<tool_result>'))?.content)
    expect(recovery).toContain('may have executed')
    expect(recovery).toContain('Do not replay')
    expect(recovery).not.toContain('effect-observed')
  })
})

it('matches a relative file receipt against the session workspace, not process cwd', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const callId = 'relative-write-call'
    const args = { path: 'reports/report.txt', content: 'report' }
    const workspacePath = agent.getWorkingDirectory()
    expect(workspacePath).not.toBe(process.cwd())
    const normalizedPath = resolve(workspacePath, args.path)
    const checkpoint = await createVerifiedFileCheckpoint(agent, normalizedPath, args.content)
    const evidence = new SessionEvidence()
    evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: fileArgsDigest(args),
      requestedPath: normalizedPath,
      checkpointId: checkpoint.checkpointId,
      path: normalizedPath,
      postVersion: checkpoint.postVersion,
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
      ] },
      evidence.snapshot(),
    ], true, undefined, checkpoint.entries)

    const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(recovered).toContain('effect-observed')
    expect(recovered).toContain(normalizedPath)
    expect(recovered).toContain('Do not replay it automatically')
  })
})

it('does not attach a receipt to a reused call ID with a different tool, path, or arguments', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const callId = 'reused-write-call'
    const originalArgs = { path: '/workspace/report.txt', content: 'report' }
    const mismatches = [
      { name: 'patch_file', args: originalArgs },
      { name: 'write_file', args: { path: '/workspace/other.txt', content: 'report' } },
      { name: 'write_file', args: { path: originalArgs.path, content: 'different report' } },
    ]

    for (const [index, candidate] of mismatches.entries()) {
      const evidence = new SessionEvidence()
      evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
        state: 'effect-observed',
        effectId: callId,
        toolCallId: callId,
        toolName: 'write_file',
        argsDigest: fileArgsDigest(originalArgs),
        requestedPath: originalArgs.path,
        checkpointId: `checkpoint-reused-call-${index}`,
        path: originalArgs.path,
        postVersion: { exists: true, hash: 'c'.repeat(64) },
      }))

      await agent.loadSessionMessages([
        { role: 'system', content: internal.systemPrompt },
        { role: 'assistant', content: null, tool_calls: [
          { id: callId, type: 'function', function: { name: candidate.name, arguments: JSON.stringify(candidate.args) } },
        ] },
        evidence.snapshot(),
      ], true)

      const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
      expect(recovered).toContain('may have executed')
      expect(recovered).toContain('Do not replay it automatically')
      expect(recovered).not.toContain('effect-observed')
    }
  })
})

it('does not reuse a receipt when secret-like content values differ', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const callId = 'secret-content-write-call'
    const path = join(agent.getWorkingDirectory(), 'report.txt')
    const originalArgs = { path, content: 'token=alpha' }
    const resumedArgs = { path, content: 'token=beta' }
    expect(fileArgsDigest(originalArgs)).toBe(fileArgsDigest(resumedArgs))
    const checkpoint = await createVerifiedFileCheckpoint(agent, path, originalArgs.content)
    expect(checkpoint.entries).toContainEqual(expect.objectContaining({
      id: checkpoint.checkpointId,
      path,
      toolName: 'write_file',
      postExisted: checkpoint.postVersion.exists,
      postHash: checkpoint.postVersion.hash,
    }))

    const evidence = new SessionEvidence()
    evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: fileArgsDigest(originalArgs),
      requestedPath: path,
      checkpointId: checkpoint.checkpointId,
      path,
      postVersion: checkpoint.postVersion,
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(resumedArgs) } },
      ] },
      evidence.snapshot(),
    ], true, undefined, checkpoint.entries)

    const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(recovered).toContain('may have executed')
    expect(recovered).toContain('Do not replay it automatically')
    expect(recovered).not.toContain('effect-observed')
  })
})

it('restores unknown outcomes when a primary file receipt disagrees with its checkpoint manifest', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const callId = 'manifest-verified-write-call'
    const path = join(agent.getWorkingDirectory(), 'report.txt')
    const args = { path, content: 'report' }
    const checkpoint = await createVerifiedFileCheckpoint(agent, path, args.content)
    const mismatches = [
      { checkpointId: 'missing-checkpoint-id', path, postVersion: checkpoint.postVersion },
      { checkpointId: checkpoint.checkpointId, path: `${path}.other`, postVersion: checkpoint.postVersion },
      { checkpointId: checkpoint.checkpointId, path, postVersion: { exists: true, hash: '0'.repeat(64) } },
    ]

    for (const [index, mismatch] of mismatches.entries()) {
      const evidence = new SessionEvidence()
      evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
        state: 'effect-observed',
        effectId: callId,
        toolCallId: callId,
        toolName: 'write_file',
        argsDigest: fileArgsDigest(args),
        requestedPath: path,
        ...mismatch,
      }))

      await agent.loadSessionMessages([
        { role: 'system', content: internal.systemPrompt },
        { role: 'assistant', content: null, tool_calls: [
          { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
        ] },
        evidence.snapshot(),
      ], true, undefined, checkpoint.entries)

      const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
      expect(recovered, `mismatch ${index} must not be trusted`).toContain('may have executed')
      expect(recovered).toContain('Do not replay it automatically')
      expect(recovered).not.toContain('effect-observed')
    }
  })
})

it('restores unknown outcomes when no checkpoint manifest is available', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    const callId = 'missing-manifest-write-call'
    const path = join(agent.getWorkingDirectory(), 'report.txt')
    const args = { path, content: 'report' }
    const checkpoints = await withHome(agent.getWorkingDirectory(), () => agent.listFileEffectCheckpoints())
    expect(checkpoints).toEqual([])
    const evidence = new SessionEvidence()
    evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: fileArgsDigest(args),
      requestedPath: path,
      checkpointId: 'missing-checkpoint-id',
      path,
      postVersion: { exists: true, hash: '1'.repeat(64) },
    }))

    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: callId, type: 'function', function: { name: 'write_file', arguments: JSON.stringify(args) } },
      ] },
      evidence.snapshot(),
    ], true, undefined, checkpoints)

    const recovered = String(agent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
    expect(recovered).toContain('may have executed')
    expect(recovered).toContain('Do not replay it automatically')
    expect(recovered).not.toContain('effect-observed')
  })
})

it('recovers a receipt across agent instances only within the same checkpoint session', async () => {
  const sessionId = `recovery-${randomUUID()}`
  await withAgent(async originalAgent => {
    const path = join(originalAgent.getWorkingDirectory(), 'report.txt')
    const args = { path, content: 'report' }
    const checkpoint = await createVerifiedFileCheckpoint(originalAgent, path, args.content)
    const callId = 'shared-session-write-call'
    const evidence = new SessionEvidence()
    evidence.add('tool', `file-effect-outcome:${callId}`, JSON.stringify({
      state: 'effect-observed',
      effectId: callId,
      toolCallId: callId,
      toolName: 'write_file',
      argsDigest: fileArgsDigest(args),
      requestedPath: path,
      checkpointId: checkpoint.checkpointId,
      path,
      postVersion: checkpoint.postVersion,
    }))
    const savedMessages = [
      { role: 'system' as const, content: (originalAgent as any).systemPrompt },
      { role: 'assistant' as const, content: null, tool_calls: [
        { id: callId, type: 'function' as const, function: { name: 'write_file', arguments: JSON.stringify(args) } },
      ] },
      evidence.snapshot(),
    ]
    const sameSessionAgent = new Agent({ provider: 'local', localModel: 'fixture' }, {
      projectRoot: originalAgent.getWorkingDirectory(), logFile: null, snapshotFile: null, sessionId,
    })
    const branchAgent = new Agent({ provider: 'local', localModel: 'fixture' }, {
      projectRoot: originalAgent.getWorkingDirectory(), logFile: null, snapshotFile: null, sessionId: `${sessionId}-branch`,
    })

    try {
      await Promise.all([sameSessionAgent.readyPromise, branchAgent.readyPromise])
      const sameSessionCheckpoints = await withHome(originalAgent.getWorkingDirectory(), () => sameSessionAgent.listFileEffectCheckpoints())
      const branchCheckpoints = await withHome(originalAgent.getWorkingDirectory(), () => branchAgent.listFileEffectCheckpoints())
      expect(sameSessionCheckpoints).toEqual(checkpoint.entries)
      expect(branchCheckpoints).toEqual([])

      await sameSessionAgent.loadSessionMessages(savedMessages, true, undefined, sameSessionCheckpoints)
      const observed = String(sameSessionAgent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
      expect(observed).toContain('effect-observed')

      await branchAgent.loadSessionMessages(savedMessages, true, undefined, branchCheckpoints)
      const unknown = String(branchAgent.getMessages().find(message => message.role === 'tool' && message.tool_call_id === callId)?.content)
      expect(unknown).toContain('may have executed')
      expect(unknown).toContain('Do not replay it automatically')
      expect(unknown).not.toContain('effect-observed')
    } finally {
      await sameSessionAgent.shutdown()
      await branchAgent.shutdown()
    }
  }, sessionId)
})

it('repairs interrupted Bedrock prompt calls with bounded unknown-result envelopes', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    await agent.loadSessionMessages([
      { role: 'system', content: internal.systemPrompt },
      { role: 'assistant', content: '<tool_call><name>shell</name><args>{"command":"write something"}</args></tool_call>' },
    ], true)

    const recovery = agent.getMessages().find(message => message.role === 'user' && String(message.content).includes('<tool_result>'))
    expect(String(recovery?.content)).toContain('<name>shell</name>')
    expect(String(recovery?.content)).toContain('may have executed')
    expect(String(agent.getMessages().find(message => message.role === 'user' && String(message.content).includes('<resume-state>'))?.content)).toContain('unknown outcomes')
  })
})
