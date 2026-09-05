import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Shell } from '../src/tools/Shell/Shell.js'
import { OrchestratorSession } from '../src/orchestration/OrchestratorSession.js'
import type { ToolExecutionContext } from '../src/orchestration/types.js'

const roots: string[] = []
const sessions: OrchestratorSession[] = []

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.shutdown('shell background test cleanup')
    await session.registry.awaitIdle()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function createContext(): Promise<ToolExecutionContext> {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-shell-background-'))
  roots.push(root)
  const session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
  sessions.push(session)
  return session.toolContext({
    workspacePath: root,
    permissionProfile: 'coordinator-integrator',
    dangerousOperationApproved: true,
  })
}

describe('shell background execution', () => {
  it('exposes a typed controllable handle and stores the eventual result', async () => {
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
    expect(context.session!.registry.getStatus(handle.taskId).type).toBe('shell')
  })

  it('cancels a running shell through the shared task registry', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'sleep 5', background: true }, context)) as { taskId: string }

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(context.session!.registry.cancel(handle.taskId, 'test cancellation')).toBe(true)
    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('cancelled')
    expect(context.session!.registry.getStatus(handle.taskId).state).toBe('cancelled')
  })

  it('marks a non-zero exit as failed instead of returning done with an error string', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'exit 7', background: true }, context)) as { taskId: string }

    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('TASK_FAILED')
    expect(context.session!.registry.getStatus(handle.taskId).state).toBe('failed')
  })

  it('lets the registry own the timeout state for detached commands', async () => {
    const context = await createContext()
    const handle = JSON.parse(await Shell.execute({ command: 'sleep 5', timeout: 0.05, background: true }, context)) as { taskId: string }

    const result = await context.session!.registry.awaitResult(handle.taskId)
    expect(result.status).toBe('timed_out')
    expect(result.error?.code).toBe('TIMED_OUT')
    expect(context.session!.registry.getStatus(handle.taskId).state).toBe('timed_out')
  })

  it('keeps the foreground result contract when background is omitted', async () => {
    const context = await createContext()
    const result = await Shell.execute({ command: 'printf foreground-ok' }, context)
    expect(result).toContain('foreground-ok')
    expect(result).not.toContain('"type":"shell"')
  })

  it('declares background as an optional boolean in the tool schema', () => {
    const properties = (Shell.parameters as { properties: Record<string, { type?: string }> }).properties
    expect(properties.background?.type).toBe('boolean')
  })
})
