import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchestratorSession } from '../src/orchestration/index.js'
import { MemoryTool } from '../src/tools/Memory/MemoryTool.js'

const roots: string[] = []
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'deepseek-memory-session-'))
  roots.push(value)
  return value
}
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })

describe('session-owned memory', () => {
  it('does not leak project memory or tool operations between sessions', async () => {
    const first = new OrchestratorSession({ sessionId: 'first', projectRoot: await root(), logFile: null })
    const second = new OrchestratorSession({ sessionId: 'second', projectRoot: await root(), logFile: null })
    await Promise.all([
      first.memory.configure({ scope: 'project' }),
      second.memory.configure({ scope: 'project' }),
    ])
    await MemoryTool.execute({ action: 'add', target: 'agent', content: 'first-only' }, first.toolContext())
    expect(await first.memory.load('agent')).toEqual(['first-only'])
    expect(await second.memory.load('agent')).toEqual([])
  })

  it('serializes updates to a shared memory scope across sessions', async () => {
    const directory = await root()
    const first = new OrchestratorSession({ sessionId: 'shared-first', projectRoot: await root(), logFile: null, snapshotFile: null })
    const second = new OrchestratorSession({ sessionId: 'shared-second', projectRoot: await root(), logFile: null, snapshotFile: null })
    first.memory.setDirectory(directory)
    second.memory.setDirectory(directory)
    await Promise.all([first.memory.add('agent', 'a'), second.memory.add('agent', 'b')])
    expect(new Set(await first.memory.load('agent'))).toEqual(new Set(['a', 'b']))
  })

  it('serializes clear with mutations and propagates non-ENOENT reads', async () => {
    const directory = await root()
    const session = new OrchestratorSession({ projectRoot: await root(), logFile: null, snapshotFile: null })
    session.memory.setDirectory(directory)
    await Promise.all([session.memory.add('agent', 'must be cleared'), session.memory.clear()])
    expect(await session.memory.load('agent')).toEqual([])
    await mkdir(join(directory, 'MEMORY.md'), { recursive: true })
    await expect(session.memory.load('agent')).rejects.toThrow()
  })

  it('refuses project rebasing while work is active and uses the new root afterwards', async () => {
    const initial = await root()
    const target = await root()
    const session = new OrchestratorSession({ projectRoot: initial, logFile: null })
    const pending = session.spawn({ taskId: 'pending' }, ({ signal }) => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    await expect(session.changeProjectRoot(target)).rejects.toThrow('active')
    pending.cancel()
    await session.changeProjectRoot(target)
    const next = session.spawn({ taskId: 'next' }, async context => context.projectRoot)
    expect((await next.awaitResult()).value).toBe(target)
  })
})
