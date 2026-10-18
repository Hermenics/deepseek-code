import { afterEach, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('does not write inferred user preferences from syncTurn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-memory-opt-in-'))
  roots.push(root)
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, {
    projectRoot: root,
    memoryDirectory: join(root, 'memory'),
    logFile: null,
    snapshotFile: null,
  })

  try {
    await agent.readyPromise
    const internal = agent as any
    internal.messages = [
      { role: 'assistant', content: 'I prefer concise replies.' },
      { role: 'assistant', content: 'Understood.' },
    ]
    internal.client = {
      chat: {
        completions: {
          create: mock(async () => ({
            choices: [{ message: { content: JSON.stringify({ kind: 'user_preference', fact: 'Prefers concise replies' }) } }],
            usage: {},
          })),
        },
      },
    }
    const add = mock(agent.orchestrator.memory.add.bind(agent.orchestrator.memory))
    agent.orchestrator.memory.add = add

    internal.syncTurn()
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(add).not.toHaveBeenCalledWith('user', expect.any(String), expect.anything())
    expect(await agent.orchestrator.memory.load('user')).toEqual([])
  } finally {
    await agent.shutdown()
  }
})
