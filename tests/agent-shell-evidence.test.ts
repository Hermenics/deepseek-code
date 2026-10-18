import { expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, fileCheckpointSessionKey } from '../src/agent/agent.js'
import type { ShellExecutionReceiptV1 } from '../src/orchestration/types.js'
import type { Tool } from '../src/tools/types.js'

function receipt(state: ShellExecutionReceiptV1['state'] = 'completed'): ShellExecutionReceiptV1 {
  return {
    schema: 'shell_execution_v1',
    state,
    exitCode: state === 'completed' ? 0 : null,
    signal: null,
    timedOut: false,
    cancelled: false,
    cwd: '/workspace/project',
    projectRoot: '/workspace/project',
    workspaceObservation: {
      schema: 'shell_workspace_observation_v1',
      scope: 'workspace-source-inputs',
      status: 'unknown',
      cwdRelative: '.',
      processGroupSettled: 'unknown',
    },
    executor: { kind: 'bubblewrap', commandExecutable: 'unknown' },
    outputPreview: 'x'.repeat(1_100),
    outputChars: 1_100,
    outputTruncated: true,
    drainTimedOut: false,
    outputId: 'bounded-output-id',
    outputArtifact: {
      kind: 'log', totalChars: 1_100, storedChars: 1_000, truncated: true, redacted: true, storage: 'disk',
    },
  }
}

async function withAgent(run: (agent: Agent) => Promise<void>, checkpointHistory: (messages: unknown[]) => void | Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-evidence-'))
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    logFile: null,
    snapshotFile: null,
    checkpointHistory,
  })
  try {
    await agent.readyPromise
    await run(agent)
  } finally {
    await agent.shutdown()
    await rm(root, { recursive: true, force: true })
  }
}

it('persists bounded Shell receipts under native Bedrock call IDs without changing returned text', async () => {
  const checkpoints: unknown[][] = []
  await withAgent(async agent => {
    const internal = agent as any
    internal.provider = 'bedrock'
    agent.model = 'us.deepseek.v3.2-v1:0' as any
    const tool = internal.toolMap.get('shell') as Tool
    let returnedReceiptId: string | undefined
    const manyFileChanges = receipt()
    manyFileChanges.workspaceObservation.fileChanges = Array.from({ length: 50 }, (_, index) => ({ path: `file-${index}.ts`, change: 'modified' as const }))
    manyFileChanges.workspaceObservation.omittedFileChanges = 7
    internal.toolMap.set('shell', {
      ...tool,
      execute: async (_args: Record<string, unknown>, context: any) => {
        returnedReceiptId = await context.recordShellExecution(manyFileChanges)
        return 'model-visible shell output'
      },
    })

    const callId = 'bedrock-v32-shell-call'
    const result = await internal.executeTool('shell', { command: 'printf output' }, false, [], undefined, undefined, callId)
    expect(result).toBe('model-visible shell output')

    const source = `shell-execution-outcome:${callId}`
    const saved = internal.sessionEvidence.latest(source)
    expect(saved?.id).toBe(returnedReceiptId)
    const data = JSON.parse(saved!.text)
    expect(data).toMatchObject({ schema: 'shell_execution_v1', state: 'completed', toolCallId: callId })
    expect(data.outputPreview).toHaveLength(1_000)
    expect(data.outputArtifact).toEqual({
      kind: 'log', totalChars: 1_100, storedChars: 1_000, truncated: true, redacted: true, storage: 'disk',
    })
    expect(data.workspaceObservation.fileChanges).toHaveLength(32)
    expect(data.workspaceObservation.omittedFileChanges).toBe(25)
    expect(checkpoints.some(snapshot => JSON.stringify(snapshot).includes(source))).toBe(true)
  }, async messages => { checkpoints.push(messages) })
})

it('derives stable filesystem-safe file checkpoint namespaces for persisted and bot sessions', () => {
  const first = fileCheckpointSessionKey('bot:calendar:run:occurrence-2026-10-17')
  const reopened = fileCheckpointSessionKey('bot:calendar:run:occurrence-2026-10-17')

  expect(first).toBe(reopened)
  expect(first).toMatch(/^[a-f0-9]{64}$/)
})

it('keeps Bedrock R1 without a Shell receipt callback because its emulated call IDs are not stable', async () => {
  await withAgent(async agent => {
    const internal = agent as any
    internal.provider = 'bedrock'
    agent.model = 'us.deepseek.r1-v1:0' as any
    const tool = internal.toolMap.get('shell') as Tool
    let callbackAvailable = false
    internal.toolMap.set('shell', {
      ...tool,
      execute: async (_args: Record<string, unknown>, context: any) => {
        callbackAvailable = typeof context.recordShellExecution === 'function'
        return 'unchanged shell output'
      },
    })

    const result = await internal.executeTool('shell', { command: 'printf output' }, false, [], undefined, undefined, 'r1-emulated-call')
    expect(result).toBe('unchanged shell output')
    expect(callbackAvailable).toBe(false)
    expect(internal.sessionEvidence.latest('shell-execution-outcome:r1-emulated-call')).toBeUndefined()
  }, async () => {})
})

it('marks a Shell receipt unknown and asks for inspection when checkpointing fails after execution', async () => {
  const checkpoints: unknown[][] = []
  await withAgent(async agent => {
    const internal = agent as any
    internal.provider = 'bedrock'
    agent.model = 'us.deepseek.v3.1-v1:0' as any
    const tool = internal.toolMap.get('shell') as Tool
    let commandStarted = false
    internal.toolMap.set('shell', {
      ...tool,
      execute: async (_args: Record<string, unknown>, context: any) => {
        commandStarted = true
        await context.recordShellExecution(receipt('completed'))
        return 'must not be reported as success'
      },
    })

    const callId = 'bedrock-v31-shell-call'
    const result = await internal.executeTool('shell', { command: 'printf output' }, false, [], undefined, undefined, callId)
    const error = JSON.parse(result)
    expect(commandStarted).toBe(true)
    expect(error.error.code).toBe('SHELL_EVIDENCE_CHECKPOINT_FAILED')
    expect(error.error.message).toMatch(/may already have run.*Inspect current effects before retrying/i)

    const saved = internal.sessionEvidence.latest(`shell-execution-outcome:${callId}`)
    expect(JSON.parse(saved!.text)).toMatchObject({ state: 'unknown', toolCallId: callId, receiptPersistence: 'unknown' })
    expect(checkpoints.every(snapshot => !JSON.stringify(snapshot).includes(`shell-execution-outcome:${callId}`))).toBe(true)
  }, async messages => {
    const hasReceipt = JSON.stringify(messages).includes('shell-execution-outcome:bedrock-v31-shell-call')
    if (hasReceipt) throw new Error('fixture checkpoint failure')
    checkpoints.push(messages)
  })
})
