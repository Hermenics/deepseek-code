import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createShellToolForTesting, resolveShellBackgroundRunner, Shell } from '../src/tools/Shell/Shell.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import type { ToolExecutionContext } from '../src/orchestration/types.js'
import { captureWorkspaceVersion, serializeWorkspaceFileDigests } from '../src/agent/workspaceVersion.js'
import { normalizeToolResult } from '../src/tools/result.js'
import { AGGREGATE_TURN_BYTES } from '../src/orchestration/aggregateBudget.js'
import { sandboxAvailable } from '../src/utils/platform.js'

// A contextual shell fails closed without bubblewrap (macOS, Windows, Linux without bwrap), so only the schema check runs there.
const itWithSandbox = it.skipIf(!sandboxAvailable())

const roots: string[] = []
const sessions: OrchestratorSession[] = []

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.shutdown('shell background test cleanup')
    await session.registry.awaitIdle()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function createContext(): Promise<ToolExecutionContext & { shellOutputRoot: string; shellOutputRecoveryRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-background-'))
  roots.push(root)
  const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
  sessions.push(session)
  return Object.assign(session.toolContext({
    workspacePath: root,
    permissionProfile: 'coordinator-integrator',
    dangerousOperationApproved: true,
  }), { shellOutputRoot: root, shellOutputRecoveryRoot: join(root, '.deepseek-code', 'shell-output-recovery') })
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition timed out')
}

describe('shell background execution', () => {
  itWithSandbox('charges foreground output while the capture is still running without charging it twice', async () => {
    const context = await createContext()
    const budgetGroupId = 'foreground-shell-progress'
    const output = 'metered output'
    const outputBytes = Buffer.byteLength(output)
    let signalOutput!: () => void
    let finishCapture!: () => void
    const outputObserved = new Promise<void>(resolve => { signalOutput = resolve })
    const captureGate = new Promise<void>(resolve => { finishCapture = resolve })
    const tool = createShellToolForTesting(async (_command, _cwd, _timeout, _readOnly, _allowNetwork, _signal, _trackProcess, _bwrapExecutable, onOutputBytes) => {
      onOutputBytes?.(outputBytes)
      signalOutput()
      await captureGate
      return {
        all: output, preview: output, totalChars: output.length, totalBytes: outputBytes,
        truncated: false, drainTimedOut: false, processGroupSettled: 'settled' as const,
        provenance: { schema: 'shell_channel_provenance_v1' as const, ordering: 'observed-arrival' as const,
          stdoutChars: output.length, stderrChars: 0, retainedChars: output.length,
          segments: [{ sequence: 1, channel: 'stdout' as const, offset: 0, channelOffset: 0, length: output.length }],
          segmentsOmitted: 0, contentOmitted: 0, drainTimedOut: false },
      }
    })
    const resultPromise = tool.execute({ command: 'printf metered-output' }, { ...context, budgetGroupId })
    await outputObserved

    const lease = await context.session!.registry.acquireAggregateBudget(budgetGroupId)
    expect(() => lease!.reserveRequestBytes(AGGREGATE_TURN_BYTES - outputBytes + 1)).toThrow('Serialized provider requests exceed')
    lease!.release()
    finishCapture()

    expect(await resultPromise).toContain(output)
    const exactFit = await context.session!.registry.acquireAggregateBudget(budgetGroupId)
    expect(exactFit!.reserveRequestBytes(AGGREGATE_TURN_BYTES - outputBytes)).toBe(0)
    exactFit!.release()
  })

  itWithSandbox('exposes a typed controllable handle and stores the eventual result', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'printf background-ok', background: true }, context)) as {
      schemaVersion: number
      sessionId: string
      taskId: string
      type: string
      state: string
    }

    expect(handle.schemaVersion).toBe(1)
    expect(handle.sessionId).toBe(context.sessionId)
    expect(handle.taskId).toBeString()
    expect(handle.type).toBe('shell')
    expect(['queued', 'running']).toContain(handle.state)

    const result = await context.session!.registry.awaitResult<string>(handle.taskId)
    expect(result.status).toBe('done')
    expect(result.value).toContain('background-ok')
    expect(result.partial).toMatchObject({
      schema: 'shell_execution_v1', state: 'exited', exitCode: 0, effects: 'not-reconciled',
      workspaceObservation: {
        schema: 'shell_workspace_observation_v1', scope: 'workspace-source-inputs', status: 'no-change-observed',
        processGroupSettled: 'settled', fileChangesStatus: 'complete', fileChanges: [], omittedFileChanges: 0,
      },
    })
    const outputId = (result.partial as { outputId: string }).outputId
    expect(result.artifacts).toContainEqual(expect.objectContaining({ id: outputId, kind: 'log' }))
    expect(await Shell.execute({ output_id: outputId, max_chars: 512 }, context)).toContain('background-ok')
    const status = context.session!.registry.getStatus(handle.taskId)
    expect(status.type).toBe('shell')
    expect(status.artifactRefs).toContain(outputId)
    expect(status.effectLedger).toMatchObject([expect.objectContaining({ tool: 'unclassified_task_runner', state: 'unknown' })])
    expect(status.process?.status).toBe('exited')
    expect(status.process?.provenance).toBe('child-event')
    expect(status.process?.exitCode).toBe(0)
  })

  itWithSandbox('records workspace changes made by a background Shell command', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'printf changed > changed.txt', background: true }, context)) as { taskId: string }
    const result = await context.session!.registry.awaitResult(handle.taskId)
    const partial = result.partial as { workspaceObservation: {
      status: string; baselineDigest: string; observedDigest?: string; fileChangesStatus?: string;
      fileChanges?: Array<{ path: string; change: string }>; omittedFileChanges?: number;
    } }
    expect(result.status).toBe('done')
    expect(partial.workspaceObservation.status).toBe('changed')
    expect(partial.workspaceObservation.observedDigest).not.toBe(partial.workspaceObservation.baselineDigest)
    expect(partial.workspaceObservation).toMatchObject({
      fileChangesStatus: 'complete', fileChanges: [{ path: 'changed.txt', change: 'added' }], omittedFileChanges: 0,
    })
    expect(context.session!.registry.getStatus(handle.taskId).effectLedger).toMatchObject([
      expect.objectContaining({
        tool: 'unclassified_task_runner', state: 'effect-observed',
        evidence: `shell-workspace-changed:${partial.workspaceObservation.observedDigest}`,
      }),
    ])
  })

  itWithSandbox('records only positive foreground Shell file changes against delegated effect markers', async () => {
    const context = await createContext()
    const handle = context.session!.spawn({ type: 'test-shell-effect', maxRetries: 0 }, async runContext => {
      const execute = async (command: string) => {
        const effectId = await runContext.markEffectStarted('shell')
        const toolContext = Object.assign(context.session!.toolContext({
          taskId: runContext.taskId, workspacePath: context.workspacePath,
          permissionProfile: 'coordinator-integrator', dangerousOperationApproved: true,
          markEffectOutcome: runContext.markEffectOutcome,
        }), { effectId, shellOutputRoot: context.shellOutputRoot, shellOutputRecoveryRoot: context.shellOutputRecoveryRoot })
        return Shell.execute({ command }, toolContext)
      }
      await execute('printf foreground-read')
      return execute('printf changed > foreground.txt')
    })

    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('done')
    const effects = context.session!.registry.getStatus(handle.taskId).effectLedger!
    expect(effects).toHaveLength(3)
    expect(effects[0]).toMatchObject({ tool: 'unclassified_task_runner', state: 'unknown' })
    expect(effects[1]).toMatchObject({ tool: 'shell', state: 'unknown' })
    expect(effects[2]).toMatchObject({ tool: 'shell', state: 'effect-observed' })
    expect(effects[2]!.evidence).toMatch(/^shell-workspace-changed:[0-9a-f]{64}$/)
  })

  itWithSandbox('waits for sandbox descendants to stop before reporting completion', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({
      command: '(sleep 0.25; printf late > late.txt) >/dev/null 2>&1 &', background: true,
    }, context)) as { taskId: string }
    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('done')
    expect((result.partial as { workspaceObservation: { processGroupSettled: string } }).workspaceObservation.processGroupSettled).toBe('settled')
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(await readFile(join(context.shellOutputRoot, 'late.txt'), 'utf8').then(() => true, () => false)).toBe(false)
  })

  itWithSandbox('reattaches retained output through a restored task snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-restart-'))
    roots.push(root)
    const snapshotFile = join(root, 'tasks.json')
    const session = new OrchestratorSession({ sessionId: 'shell-restart', projectRoot: root, snapshotFile, logFile: null })
    sessions.push(session)
    const context = Object.assign(session.toolContext({ workspacePath: root, permissionProfile: 'coordinator-integrator' }), { shellOutputRoot: root, shellOutputRecoveryRoot: join(root, '.deepseek-code', 'shell-output-recovery') })
    const handle = JSON.parse(await Shell.execute({ command: 'printf restart-output', background: true }, context)) as { taskId: string }
    const result = await session.registry.awaitResult(handle.taskId)
    const outputId = (result.partial as { outputId: string }).outputId
    await session.flush()

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    sessions.push(restored)
    const restoredContext = Object.assign(restored.toolContext({ workspacePath: root, permissionProfile: 'coordinator-integrator' }), { shellOutputRoot: root, shellOutputRecoveryRoot: join(root, '.deepseek-code', 'shell-output-recovery') })
    expect(restored.registry.getStatus(handle.taskId).artifacts).toContainEqual(expect.objectContaining({ id: outputId, kind: 'log' }))
    expect(await Shell.execute({ output_id: outputId, max_chars: 512 }, restoredContext)).toContain('restart-output')
  })

  itWithSandbox('reattaches a live background shell after its CLI process exits without replaying it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-live-restart-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const budgetGroupId = 'primary-shell-turn'
    const snapshotFile = join(root, 'tasks.json')
    const sessionUrl = new URL('../src/orchestration/OrchestratorSession.ts', import.meta.url).href
    const shellUrl = new URL('../src/tools/Shell/Shell.ts', import.meta.url).href
    const controllerSource = `
      const { OrchestratorSession } = await import(${JSON.stringify(sessionUrl)});
      const { resolveShellBackgroundRunner, Shell } = await import(${JSON.stringify(shellUrl)});
      const root = ${JSON.stringify(root)};
      const session = new OrchestratorSession({ sessionId: 'live-shell-restart', projectRoot: root, snapshotFile: ${JSON.stringify(snapshotFile)}, logFile: null });
      const recoveryRoot = root + '/.deepseek-code/shell-output-recovery';
      const context = Object.assign(session.toolContext({ workspacePath: ${JSON.stringify(workspace)}, budgetGroupId: ${JSON.stringify(budgetGroupId)}, permissionProfile: 'coordinator-integrator', dangerousOperationApproved: true }), { shellOutputRoot: root, shellOutputRecoveryRoot: recoveryRoot });
      const handle = JSON.parse(await Shell.execute({ command: "printf stream-live; sleep 2.5; printf x >> restart-count; printf workspace-after-restart > restart-file; printf after-restart; printf done > completion-marker", background: true }, context));
      const deadline = Date.now() + 5000;
      while (!resolveShellBackgroundRunner(session.registry.getStatus(handle.taskId), root, recoveryRoot) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (!resolveShellBackgroundRunner(session.registry.getStatus(handle.taskId), root, recoveryRoot)) throw new Error('shell supervisor did not become reattachable');
      await session.flush();
      await new Promise(resolve => process.stdout.write(JSON.stringify(handle), resolve));
      process.exit(0);
    `
    const controller = spawn(process.execPath, ['-e', controllerSource], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    controller.stdout!.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    controller.stderr!.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      controller.once('error', reject)
      controller.once('close', code => resolve(code))
    })
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    const handle = JSON.parse(stdout) as { taskId: string }

    let restored!: OrchestratorSession
    let restoredOutputCharge: { budgetGroupId: string | undefined; bytes: number } | undefined
    let outputChargedBeforeCommandFinished = false
    const pendingOutputCharges: number[] = []
    let resolveOutputCharge!: () => void
    const outputChargeObserved = new Promise<void>(resolve => { resolveOutputCharge = resolve })
    restored = await OrchestratorSession.restore({
      projectRoot: root,
      snapshotFile,
      logFile: null,
      runnerResolver: record => resolveShellBackgroundRunner(record, root, join(root, '.deepseek-code', 'shell-output-recovery'), bytes => {
        restoredOutputCharge = { budgetGroupId: record.budgetGroupId, bytes: (restoredOutputCharge?.bytes ?? 0) + bytes }
        if (!existsSync(join(workspace, 'completion-marker'))) outputChargedBeforeCommandFinished = true
        resolveOutputCharge()
        if (!restored) {
          pendingOutputCharges.push(bytes)
          return true
        }
        return restored.registry.recordAggregateOutputBytes(record.budgetGroupId, bytes)
      }),
    })
    for (const bytes of pendingOutputCharges) restored.registry.recordAggregateOutputBytes(budgetGroupId, bytes)
    sessions.push(restored)
    expect(restored.registry.getStatus(handle.taskId).budgetGroupId).toBe(budgetGroupId)
    await outputChargeObserved
    expect(restoredOutputCharge?.bytes).toBeGreaterThan(0)
    expect(outputChargedBeforeCommandFinished).toBe(true)
    const result = await restored.registry.awaitResult(handle.taskId)
    if (result.status !== 'done') throw new Error(JSON.stringify(result))
    expect(result.status).toBe('done')
    expect(result.value).toContain('after-restart')
    expect(restoredOutputCharge?.budgetGroupId).toBe(budgetGroupId)
    expect(typeof restoredOutputCharge?.bytes).toBe('number')
    expect(Number.isFinite(restoredOutputCharge?.bytes)).toBe(true)
    expect(restoredOutputCharge?.bytes).toBeGreaterThan(0)
    expect(restored.registry.recordAggregateOutputBytes(budgetGroupId, AGGREGATE_TURN_BYTES - restoredOutputCharge!.bytes)).toBe(true)
    expect(restored.registry.recordAggregateOutputBytes(budgetGroupId, 1)).toBe(false)
    expect(await readFile(join(workspace, 'restart-count'), 'utf8')).toBe('x')
    expect(await readFile(join(workspace, 'restart-file'), 'utf8')).toBe('workspace-after-restart')
    expect(restored.registry.getStatus(handle.taskId).process?.status).toBe('exited')
    expect((result.partial as { effects: string; workspaceObservation: { fileChangesStatus?: string; fileChanges?: Array<{ path: string; change: string }>; status: string } })).toMatchObject({
      effects: 'not-reconciled', workspaceObservation: {
        status: 'changed', fileChangesStatus: 'complete',
        fileChanges: [
          { path: 'completion-marker', change: 'added' },
          { path: 'restart-count', change: 'added' },
          { path: 'restart-file', change: 'added' },
        ],
      },
    })
  }, 15_000)

  it('recovers per-file changes for an interrupted Shell task when no runner can reattach', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-interrupted-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const snapshotFile = join(root, 'tasks.json')
    const session = new OrchestratorSession({ sessionId: 'interrupted-shell', projectRoot: root, snapshotFile, logFile: null })
    sessions.push(session)
    const baseline = await captureWorkspaceVersion(workspace, undefined, [], { includeFileDigests: true })
    const handle = session.spawn({ type: 'shell', maxRetries: 0 }, async runContext => {
      runContext.setPartial({
        schema: 'shell_execution_v1', state: 'running', exitCode: null, signal: null, effects: 'not-reconciled',
        workspaceObservation: {
          schema: 'shell_workspace_observation_v1', scope: 'workspace-source-inputs', status: 'pending',
          cwdRelative: 'workspace', baselineDigest: baseline.digest, capturedAt: new Date().toISOString(), processGroupSettled: 'unknown',
        },
        workspaceBaselineFileDigests: serializeWorkspaceFileDigests(baseline.fileDigests),
        outputChars: 0, outputTruncated: false, drainTimedOut: false,
      })
      await new Promise<void>(resolve => runContext.signal.addEventListener('abort', () => resolve(), { once: true }))
      return 'stopped'
    })
    await waitFor(async () => (session.registry.getStatus(handle.taskId).partial as { workspaceObservation?: { status?: string } } | undefined)?.workspaceObservation?.status === 'pending')
    await session.flush()
    await writeFile(join(workspace, 'new-after-interrupt.ts'), 'created after the last saved task snapshot')

    const restored = await OrchestratorSession.restore({ projectRoot: root, snapshotFile, logFile: null })
    sessions.push(restored)
    expect(restored.registry.getStatus(handle.taskId).partial).toMatchObject({
      workspaceObservation: {
        status: 'changed', fileChangesStatus: 'complete',
        fileChanges: [{ path: 'new-after-interrupt.ts', change: 'added' }], omittedFileChanges: 0,
      },
    })
  })

  itWithSandbox('retains the last redacted preview when its detached supervisor exits before saving the final artifact', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: "printf 'crash-preview\\n'; sleep 30", timeout: 10, background: true }, context)) as { taskId: string }

    await waitFor(async () => {
      const status = context.session!.registry.getStatus(handle.taskId)
      const partial = status.partial as { outputPreview?: string } | undefined
      return Boolean(status.process?.identity?.pid && partial?.outputPreview?.includes('crash-preview'))
    }, 5_000)
    const supervisorPid = context.session!.registry.getStatus(handle.taskId).process?.identity?.pid
    if (!supervisorPid) throw new Error('Shell supervisor process identity was not recorded')
    process.kill(supervisorPid, 'SIGKILL')

    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('SHELL_SUPERVISOR_LOST')
    const outputId = (result.partial as { outputId?: string }).outputId
    expect(outputId).toBeString()
    expect(result.partial).toMatchObject({
      outputPreview: expect.stringContaining('crash-preview'),
      outputTruncated: true,
      effects: 'not-reconciled',
      workspaceObservation: { status: 'unknown', fileChangesStatus: 'unknown', processGroupSettled: 'unknown' },
    })
    expect(result.artifacts).toContainEqual(expect.objectContaining({ id: outputId, kind: 'log' }))
    expect(result.error?.message).toContain(`shell output_id="${outputId}"`)
    const recovered = await Shell.execute({ output_id: outputId!, max_chars: 512 }, context)
    expect(recovered).toContain('crash-preview')
    expect(recovered).toContain('Only the last redacted progress preview was retained; the full output is unavailable.')
  })

  itWithSandbox('tracks sequential foreground Shell commands under their subagent task', async () => {
    const context = await createContext()
    const session = context.session!
    const task = session.spawn({ taskId: 'foreground-shell-owner', maxRetries: 0 }, async runContext => {
      const taskContext = session.toolContext({
        taskId: runContext.taskId,
        workspacePath: runContext.workspacePath,
        signal: runContext.signal,
        trackProcess: runContext.trackProcess,
        permissionProfile: 'coordinator-integrator',
      })
      const first = await Shell.execute({ command: 'printf first' }, taskContext)
      const second = await Shell.execute({ command: 'printf second' }, taskContext)
      return first + second
    })

    const result = await task.awaitResult()
    expect(result.status).toBe('done')
    expect(result.value).toContain('first')
    expect(result.value).toContain('second')
    expect(task.status().process?.status).toBe('exited')
  })

  itWithSandbox('cancels and reaps a foreground Shell child from its owning task', async () => {
    const context = await createContext()
    const session = context.session!
    const task = session.spawn({ taskId: 'foreground-shell-cancel', maxRetries: 0 }, async runContext => {
      return Shell.execute({ command: 'printf started > started.txt; sleep 5; printf finished > finished.txt' }, session.toolContext({
        taskId: runContext.taskId,
        workspacePath: runContext.workspacePath,
        signal: runContext.signal,
        trackProcess: runContext.trackProcess,
        permissionProfile: 'coordinator-integrator',
      }))
    })

    await waitFor(async () => await readFile(join(context.shellOutputRoot, 'started.txt'), 'utf8').then(value => value === 'started', () => false))
    expect(task.status().process?.identity?.pid).toBeGreaterThan(0)
    expect(task.cancel('stop foreground shell')).toBe(true)
    await session.registry.awaitIdle()

    expect(task.getResult()?.status).toBe('cancelled')
    expect(task.status().process?.status).toBe('exited')
    expect(await readFile(join(context.shellOutputRoot, 'finished.txt'), 'utf8').then(() => true, () => false)).toBe(false)
  })

  itWithSandbox('kills a Shell child that cannot be registered alongside an active task child', async () => {
    const context = await createContext()
    const session = context.session!
    let firstTracked!: () => void
    const tracked = new Promise<void>(resolve => { firstTracked = resolve })
    const task = session.spawn({ taskId: 'overlapping-shell-children', maxRetries: 0 }, async runContext => {
      const taskContext = session.toolContext({
        taskId: runContext.taskId,
        workspacePath: runContext.workspacePath,
        signal: runContext.signal,
        trackProcess: child => { runContext.trackProcess(child); firstTracked() },
        permissionProfile: 'coordinator-integrator',
      })
      const first = Shell.execute({ command: 'sleep 1' }, taskContext)
      await tracked
      const second = await Shell.execute({ command: 'printf duplicate > duplicate.txt' }, taskContext)
      return `${await first}\n${second}`
    })

    const result = await task.awaitResult()
    expect(result.status).toBe('done')
    expect(result.value).toContain('already owns a running process')
    expect(await readFile(join(context.shellOutputRoot, 'duplicate.txt'), 'utf8').then(() => true, () => false)).toBe(false)
  })

  itWithSandbox('preserves partial output and side effects when a running shell is cancelled', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'printf before-cancel; printf changed > partial.txt; sleep 5; printf after-cancel', background: true }, context)) as { taskId: string }

    await waitFor(async () => await readFile(join(context.shellOutputRoot, 'partial.txt'), 'utf8').then(value => value === 'changed', () => false))
    expect(context.session!.registry.cancel(handle.taskId, 'test cancellation')).toBe(true)
    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('cancelled')
    await context.session!.registry.awaitIdle()
    const reconciled = context.session!.registry.getResult(handle.taskId)!
    expect(reconciled.partial).toMatchObject({
      schema: 'shell_execution_v1', state: 'cancelled', effects: 'not-reconciled',
      workspaceObservation: { status: 'changed', processGroupSettled: 'settled' },
    })
    const outputId = (reconciled.partial as { outputId: string }).outputId
    expect(reconciled.artifacts).toContainEqual(expect.objectContaining({ id: outputId, kind: 'log' }))
    expect(context.session!.registry.getStatus(handle.taskId).state).toBe('cancelled')
    expect(await readFile(join(context.shellOutputRoot, 'partial.txt'), 'utf8')).toBe('changed')
    const output = await Shell.execute({ output_id: outputId, max_chars: 512 }, context)
    expect(output).toContain('before-cancel')
    expect(output).not.toContain('after-cancel')
  })

  itWithSandbox('marks a non-zero exit as failed instead of returning done with an error string', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'exit 7', background: true }, context)) as { taskId: string }

    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('SHELL_EXIT')
    expect(result.partial).toMatchObject({ schema: 'shell_execution_v1', state: 'failed', exitCode: 7 })
    expect(result.artifacts).toHaveLength(1)
    expect(context.session!.registry.getStatus(handle.taskId).state).toBe('failed')
  })

  itWithSandbox('returns foreground shell failure status and a recoverable output reference to the model', async () => {
    const context = await createContext()
    const raw = await Shell.execute({ command: 'printf SHELL-FAILURE-SENTINEL >&2; exit 7' }, context)
    const result = JSON.parse(normalizeToolResult(raw))

    expect(result).toMatchObject({
      schemaVersion: 1,
      status: 'partial',
      error: { kind: 'tool', code: 'SHELL_EXIT', retryable: false },
      partial: { state: 'failed', exitCode: 7, outputIncomplete: false },
    })
    expect(result.error.message).toBe('Command exited with code 7.')
    expect(result.partial.output).toContain('SHELL-FAILURE-SENTINEL')
    expect(result.partial.outputId).toMatch(/^[0-9a-f-]{36}$/i)

    const recovered = await Shell.execute({ output_id: result.partial.outputId, max_chars: 512 }, context)
    expect(recovered).toContain('SHELL-FAILURE-SENTINEL')
  })

  itWithSandbox('lets the registry own the timeout state for detached commands', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'sleep 5', timeout: 0.05, background: true }, context)) as { taskId: string }

    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('timed_out')
    expect(result.error?.code).toBe('TIMED_OUT')
    await context.session!.registry.awaitIdle()
    expect(context.session!.registry.getResult(handle.taskId)?.partial).toMatchObject({ schema: 'shell_execution_v1', state: 'timed_out', effects: 'not-reconciled' })
    expect(context.session!.registry.getStatus(handle.taskId).state).toBe('timed_out')
  })

  itWithSandbox('keeps the foreground result contract when background is omitted', async () => {
    const context = await createContext()
    const result = await Shell.execute({ command: 'printf foreground-ok' }, context)
    expect(result).toContain('foreground-ok')
    expect(result).not.toContain('"type":"shell"')
  })

  itWithSandbox('labels a silent foreground command successful only after the process and capture settle', async () => {
    const context = await createContext()
    expect(await Shell.execute({ command: 'true' }, context)).toBe('Command completed with exit code 0 and no output; output capture completed.')
  })

  it('declares background as an optional boolean in the tool schema', () => {
    const properties = (Shell.parameters as { properties: Record<string, { type?: string }> }).properties
    expect(properties.background?.type).toBe('boolean')
  })
})
