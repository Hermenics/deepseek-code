import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { readShellOutput } from '../src/tools/Shell/outputArtifact.js'
import { Shell } from '../src/tools/Shell/Shell.js'
import { launchShellSupervisor, waitForShellSupervisor, type ShellSupervisorRequest } from '../src/tools/Shell/supervisor.js'
import type { ToolExecutionContext } from '../src/orchestration/types.js'
import { sandboxAvailable } from '../src/utils/platform.js'

const itWithSandbox = it.skipIf(!sandboxAvailable())
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('detached shell supervisor', () => {
  itWithSandbox('keeps a bounded sandboxed run attachable after its launching controller exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-supervisor-'))
    roots.push(root)
    const request: ShellSupervisorRequest = {
      sessionId: 'supervisor-session',
      taskId: 'supervisor-task',
      storageRoot: root,
      recoveryRoot: join(root, '.deepseek-code', 'shell-output-recovery'),
      fingerprint: 'a'.repeat(64),
      executable: 'bwrap',
      args: [
        '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr', '--ro-bind-try', '/bin', '/bin',
        '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--bind', process.cwd(), '/mnt',
        '--dev', '/dev', '--proc', '/proc', '--unshare-net', '--unshare-pid', '--chdir', '/mnt', '--',
        '/bin/sh', '-c', "printf 'first api_key=supervisor-canary'; sleep 0.8; printf ' last\\n'",
      ],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    }
    const moduleUrl = new URL('../src/tools/Shell/supervisor.ts', import.meta.url).href
    const controllerSource = `
      const { launchShellSupervisor } = await import(${JSON.stringify(moduleUrl)});
      await launchShellSupervisor(${JSON.stringify(request)});
      process.stdout.write('controller-ready');
    `
    const controller = spawn(process.execPath, ['-e', controllerSource], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    controller.stdout!.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    controller.stderr!.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      controller.once('error', reject)
      controller.once('close', code => resolve(code))
    })
    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: 'controller-ready', stderr: '' })

    const progress: string[] = []
    const result = await waitForShellSupervisor(request, undefined, state => { if (state.outputPreview) progress.push(state.outputPreview) })
    expect(result.state).toBe('done')
    expect(result.exitCode).toBe(0)
    expect(result.processGroupSettled).toBe('settled')
    expect(result.outputId).toBeString()
    expect(progress.join('\n')).not.toContain('supervisor-canary')
    expect(progress.join('\n')).not.toContain('supervisor-canary')
    expect(result.content).not.toContain('supervisor-canary')
    const output = await readShellOutput(request.sessionId, result.outputId!, 0, 2_000, root, request.recoveryRoot)
    expect(output).toContain('first')
    expect(output).toContain('last')

    const shellContext = { sessionId: request.sessionId, shellOutputRoot: root } as unknown as ToolExecutionContext
    const streamPage = JSON.parse(await Shell.execute({ stream_task_id: request.taskId }, shellContext))
    expect(streamPage.schema).toBe('shell_stream_journal_v1')
    expect(streamPage.finished).toBe(true)
    expect(streamPage.records.map((record: { text: string }) => record.text).join('')).toContain('first')
    expect(streamPage.records.map((record: { text: string }) => record.text).join('')).not.toContain('supervisor-canary')
    const nextPage = JSON.parse(await Shell.execute({ stream_task_id: request.taskId, stream_cursor: streamPage.cursor }, shellContext))
    expect(nextPage.records).toEqual([])
    expect(nextPage.cursor).toBe(streamPage.cursor)
  })
})
