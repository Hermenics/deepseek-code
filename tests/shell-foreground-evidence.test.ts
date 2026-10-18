import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createShellToolForTesting, type ShellForegroundRunnerForTesting } from '../src/tools/Shell/Shell.js'
import type { ShellExecutionReceiptV1, ToolExecutionContext } from '../src/orchestration/types.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import { AGGREGATE_TURN_BYTES } from '../src/orchestration/aggregateBudget.js'
import { readShellOutput } from '../src/tools/Shell/outputArtifact.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const itWithSandbox = it.skipIf(!sandboxAvailable())
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

type CapturedOutput = Awaited<ReturnType<ShellForegroundRunnerForTesting>>

function capturedOutput(all: string, processGroupSettled: CapturedOutput['processGroupSettled'] = 'settled', truncated = false): CapturedOutput {
  return {
    all,
    preview: all,
    totalChars: all.length,
    totalBytes: Buffer.byteLength(all, 'utf8'),
    truncated,
    drainTimedOut: false,
    processGroupSettled,
    provenance: {
      schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival',
      stdoutChars: all.length, stderrChars: 0, retainedChars: all.length,
      segments: [], segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false,
    },
  }
}

async function createContext(receipts: ShellExecutionReceiptV1[], signal?: AbortSignal) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'deepseek-shell-foreground-evidence-'))
  const outputRoot = await mkdtemp(join(tmpdir(), 'deepseek-shell-foreground-output-'))
  const cwd = join(projectRoot, 'nested', 'workspace')
  await mkdir(cwd, { recursive: true })
  roots.push(projectRoot, outputRoot)
  const context: ToolExecutionContext & { shellOutputRoot: string } = {
    sessionId: `shell-receipt-${randomUUID()}`,
    workspacePath: cwd,
    projectRoot,
    permissionProfile: 'coordinator-integrator' as const,
    dangerousOperationApproved: true,
    signal,
    shellOutputRoot: outputRoot,
    recordShellExecution(receipt: ShellExecutionReceiptV1) {
      receipts.push(structuredClone(receipt))
      return `shell-evidence-${receipts.length}`
    },
  }
  return { context, cwd, projectRoot }
}

describe('foreground Shell execution receipts', () => {
  itWithSandbox('records bounded, redacted completion evidence without changing the model result', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context, cwd, projectRoot } = await createContext(receipts)
    const secret = 'receipt-secret-value-abcdefghijklmnopqrstuvwxyz'
    const shell = createShellToolForTesting(async (command, actualCwd) => {
      expect(command).toBe(`printf '%s' 'api_key=${secret}'`)
      expect(actualCwd).toBe(cwd)
      return capturedOutput(`api_key=${secret}`)
    })
    const result = await shell.execute({ command: `printf '%s' 'api_key=${secret}'` }, context)

    const channelSummary = JSON.stringify({
      schema: 'shell_channel_provenance_v1', ordering: 'observed-arrival', stdoutChars: `api_key=${secret}`.length,
      stderrChars: 0, retainedSegments: 0, segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false,
    })
    expect(result).toBe(`api_key=${secret}\n\n[Shell channel provenance JSON: ${channelSummary}]`)
    expect(result).not.toContain('shell-evidence-')
    expect(receipts.map(receipt => receipt.state)).toEqual(['running', 'completed'])
    expect(receipts[0]).toMatchObject({
      schema: 'shell_execution_v1', state: 'running', exitCode: null, signal: null,
      timedOut: false, cancelled: false, cwd, projectRoot,
    })
    const completed = receipts[1]!
    expect(completed).toMatchObject({
      schema: 'shell_execution_v1', state: 'completed', exitCode: 0, signal: null,
      timedOut: false, cancelled: false, cwd, projectRoot,
      workspaceObservation: {
        schema: 'shell_workspace_observation_v1', scope: 'workspace-source-inputs',
        status: 'no-change-observed', cwdRelative: 'nested/workspace', processGroupSettled: 'settled',
      },
      executor: { kind: 'bubblewrap', commandExecutable: 'unknown' },
    })
    expect(completed.outputPreview).toContain('api_key=')
    expect(completed.outputPreview).not.toContain(secret)
    expect(completed.outputPreview!.length).toBeLessThanOrEqual(1_000)
    if (completed.executor.path) expect(completed.executor.path.startsWith('/')).toBe(true)
    if (completed.executor.sha256) expect(completed.executor.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  itWithSandbox('records bounded artifact metadata for oversized foreground output', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context } = await createContext(receipts)
    const output = 'x'.repeat(50_001)
    const shell = createShellToolForTesting(async () => capturedOutput(output, 'settled', true))
    const result = await shell.execute({ command: 'printf oversized' }, context)
    const completed = receipts.at(-1)!

    expect(result).toContain('output_id=')
    expect(completed.state).toBe('completed')
    expect(completed.outputChars).toBe(50_001)
    expect(completed.outputPreview!.length).toBeLessThanOrEqual(1_000)
    expect(completed.outputArtifact).toMatchObject({
      kind: 'log', totalChars: 50_001, storedChars: 50_001, truncated: false,
    })
    expect(['disk', 'recovery-disk', 'emergency-disk', 'memory']).toContain(completed.outputArtifact!.storage)
    expect(completed.outputId).toBeString()
  })

  itWithSandbox('shares exact UTF-8 Shell capture bytes across calls and retains output when the group quota is exhausted', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context, projectRoot } = await createContext(receipts)
    const session = new OrchestratorSession({ sessionId: context.sessionId, projectRoot, logFile: null, snapshotFile: null })
    context.session = session
    context.budgetGroupId = 'shell-output-shared-group'
    expect(session.registry.recordAggregateOutputBytes(context.budgetGroupId, AGGREGATE_TURN_BYTES - 2)).toBe(true)
    expect(session.registry.recordAggregateOutputBytes(context.budgetGroupId, Number.NaN)).toBe(false)

    let call = 0
    const shell = createShellToolForTesting(async () => capturedOutput(call++ === 0 ? 'é' : 'x'))
    const first = await shell.execute({ command: 'printf first' }, context)
    expect(first).toContain('é')

    const second = JSON.parse(await shell.execute({ command: 'printf second' }, context)) as {
      status: string
      error: { code: string; message: string }
      partial: { outputBytes: number; outputId?: string }
    }
    expect(second.status).toBe('partial')
    expect(second.error.code).toBe('AGGREGATE_OUTPUT_BYTES_EXCEEDED')
    expect(second.error.message).toContain('may already have taken effect')
    expect(second.partial.outputBytes).toBe(1)
    expect(second.partial.outputId).toBeString()
    expect(await readShellOutput(context.sessionId, second.partial.outputId!, 0, 512, context.shellOutputRoot)).toContain('x')
    expect(session.registry.recordAggregateOutputBytes(context.budgetGroupId, 1)).toBe(false)
  })

  itWithSandbox('records a command failure separately from timeout and cancellation', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context } = await createContext(receipts)
    const shell = createShellToolForTesting(async () => {
      throw Object.assign(new Error('Command exited with code 23.'), {
        all: 'failed-output', outputPreview: 'failed-output', totalChars: 13,
        processGroupSettled: 'settled' as const, exitCode: 23,
      })
    })
    const result = await shell.execute({ command: 'false' }, context)
    const failed = receipts.at(-1)!

    expect(result).toContain('exited with code 23')
    expect(failed).toMatchObject({
      state: 'failure', exitCode: 23, signal: null, timedOut: false, cancelled: false,
      outputPreview: 'failed-output', outputChars: 13,
    })
  })

  itWithSandbox('records timeout separately from cancellation and exit status', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context } = await createContext(receipts)
    const shell = createShellToolForTesting(async () => {
      throw Object.assign(new Error('Command timed out after 0s.'), {
        all: 'partial-timeout-output', outputPreview: 'partial-timeout-output', totalChars: 22,
        processGroupSettled: 'settled' as const, timedOut: true, signal: 'SIGTERM',
      })
    })
    const result = await shell.execute({ command: 'sleep 5', timeout: 0.05 }, context)
    const timedOut = receipts.at(-1)!

    expect(result).toContain('timed out')
    expect(timedOut).toMatchObject({
      state: 'failure', timedOut: true, cancelled: false, signal: 'SIGTERM', exitCode: null,
    })
  })

  itWithSandbox('records cancellation independently from timeout and signal', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const controller = new AbortController()
    const { context } = await createContext(receipts, controller.signal)
    const shell = createShellToolForTesting(async () => {
      controller.abort(new Error('cancelled by test'))
      throw Object.assign(new Error('Command was cancelled.'), {
        all: 'partial-cancel-output', outputPreview: 'partial-cancel-output', totalChars: 21,
        processGroupSettled: 'settled' as const, cancelled: true, signal: 'SIGTERM',
      })
    })

    await shell.execute({ command: 'sleep 5' }, context)
    expect(receipts.at(-1)).toMatchObject({
      state: 'failure', timedOut: false, cancelled: true, signal: 'SIGTERM', exitCode: null,
    })
  })

  itWithSandbox('records an unknown outcome when the foreground runner cannot establish completion', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context, cwd, projectRoot } = await createContext(receipts)
    const shell = createShellToolForTesting(async () => capturedOutput('unknown-output', 'unknown'))
    const result = await shell.execute({ command: 'printf uncertain' }, context)
    const unknown = receipts.at(-1)!

    expect(result).toContain('SHELL_OUTCOME_UNKNOWN')
    expect(receipts.map(receipt => receipt.state)).toEqual(['running', 'unknown'])
    expect(unknown).toMatchObject({
      schema: 'shell_execution_v1', state: 'unknown', exitCode: 0,
      timedOut: false, cancelled: false, cwd, projectRoot,
      workspaceObservation: { status: 'unknown', processGroupSettled: 'unknown' },
      executor: { kind: 'bubblewrap', commandExecutable: 'unknown' },
    })
  })

  itWithSandbox('does not start the command when the running receipt cannot be recorded', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context } = await createContext(receipts)
    context.recordShellExecution = receipt => {
      receipts.push(structuredClone(receipt))
      throw new Error('checkpoint unavailable')
    }
    let runnerCalled = false
    const shell = createShellToolForTesting(async () => {
      runnerCalled = true
      return capturedOutput('must-not-run')
    })

    await expect(shell.execute({ command: 'printf must-not-run' }, context)).rejects.toMatchObject({
      code: 'SHELL_EVIDENCE_CHECKPOINT_FAILED',
    })
    expect(runnerCalled).toBe(false)
    expect(receipts.map(receipt => receipt.state)).toEqual(['running'])
  })

  itWithSandbox('propagates a final receipt checkpoint failure after execution may have completed', async () => {
    const receipts: ShellExecutionReceiptV1[] = []
    const { context } = await createContext(receipts)
    context.recordShellExecution = receipt => {
      receipts.push(structuredClone(receipt))
      if (receipt.state === 'completed') throw new Error('checkpoint unavailable')
      return 'shell-evidence'
    }
    let runnerCalled = false
    const shell = createShellToolForTesting(async () => {
      runnerCalled = true
      return capturedOutput('command-ran')
    })

    await expect(shell.execute({ command: 'printf command-ran' }, context)).rejects.toMatchObject({
      code: 'SHELL_EVIDENCE_CHECKPOINT_FAILED',
    })
    expect(runnerCalled).toBe(true)
    expect(receipts.map(receipt => receipt.state)).toEqual(['running', 'completed'])
  })
})
