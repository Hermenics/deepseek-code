import { expect, it } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { OrchestratorSession } from '../src/orchestration/index.js'
import { runSubAgentLoop } from '../src/tools/SubAgent/executor.js'
import type { Tool } from '../src/tools/types.js'

for (const changed of ['branch', 'index', 'config'] as const) for (const boundary of ['consent', 'journal'] as const) {
  it(`refuses worker Git execution after ${changed} changes at the ${boundary} boundary`, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'deepseek-worker-git-auth-')))
    const git = (args: string[]) => execa('git', args, { cwd: root })
    let session: OrchestratorSession | undefined
    try {
      await git(['init', '-b', 'worker-fixture'])
      await git(['config', 'user.name', 'Worker Test'])
      await git(['config', 'user.email', 'worker@example.invalid'])
      await writeFile(join(root, 'source.txt'), 'base\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'fixture'])
      await writeFile(join(root, 'source.txt'), 'approved staged content\n')
      await git(['add', 'source.txt'])
      await writeFile(join(root, 'source.txt'), 'unchanged working copy\n')
      session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
      const mutate = async () => {
        if (changed === 'branch') await git(['symbolic-ref', 'HEAD', 'refs/heads/other-branch'])
        else if (changed === 'config') await git(['config', 'user.name', 'Changed Author'])
        else {
          await writeFile(join(root, 'source.txt'), 'unapproved staged content\n')
          await git(['add', 'source.txt'])
          await writeFile(join(root, 'source.txt'), 'unchanged working copy\n')
        }
      }
      let approvals = 0
      let executions = 0
      let observation = ''
      session.requestToolPermission = async () => { approvals++; if (boundary === 'consent') await mutate(); return 'allow' as const }
      if (boundary === 'journal') session.executeJournaled = async (_name, _args, execute) => { await mutate(); return execute() }
      const tool: Tool = { name: 'git', description: 'Git fixture', parameters: { type: 'object', properties: { action: { type: 'string' }, message: { type: 'string' } } }, execute: async () => { executions++; return 'executed' } }
      let requests = 0
      const client = { chat: { completions: { create: async (request: any) => {
        requests++
        observation = request.messages.find((message: any) => message.role === 'tool')?.content ?? ''
        const message = requests === 1 ? { content: null, tool_calls: [{ id: 'worker-commit', type: 'function', function: { name: 'git', arguments: '{"action":"commit","message":"Approved commit"}' } }] } : { content: 'Fixture complete.' }
        return { choices: [{ message }], usage: {} }
      } } } }
      await runSubAgentLoop('Fixture system', 'Commit the approved change.', 'worker-git-fixture', [tool], { provider: 'local', localModel: 'fixture' }, 'fixture', {
        client: client as any, callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } },
        context: session.toolContext({ permissionProfile: 'coordinator-integrator' }),
      })
      expect(approvals).toBe(1)
      expect(executions).toBe(0)
      expect(observation).toContain('Git workspace changed')
      expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('unchanged working copy\n')
    } finally { await session?.shutdown(); await rm(root, { recursive: true, force: true }) }
  })
}

for (const scenario of ['current', 'changed', 'legacy', 'denied'] as const) {
  it(`handles ${scenario} coordinator Git permission messages with version checks`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-worker-git-mailbox-'))
    const git = (args: string[]) => execa('git', args, { cwd: root })
    let session: OrchestratorSession | undefined
    try {
      await git(['init', '-b', 'mailbox-fixture'])
      await git(['config', 'user.name', 'Mailbox Test'])
      await writeFile(join(root, 'source.txt'), 'pending source\n')
      await git(['add', 'source.txt'])
      session = new OrchestratorSession({ projectRoot: root, logFile: null, snapshotFile: null })
      let executions = 0
      const args = { action: 'commit', message: 'Approved commit' }
      const tool: Tool = { name: 'git', description: 'Git fixture', parameters: { type: 'object', properties: { action: { type: 'string' }, message: { type: 'string' } } }, execute: async () => { executions++; return 'executed' } }
      const task = session.spawn({ taskId: 'git-mailbox-fixture', maxRetries: 0, effectPolicy: 'tool-gated' }, async runContext => {
        let requests = 0
        const client = { chat: { completions: { create: async () => ({ choices: [{ message: ++requests === 1
          ? { content: null, tool_calls: [{ id: 'mailbox-commit', type: 'function', function: { name: 'git', arguments: JSON.stringify(args) } }] }
          : { content: 'Fixture complete.' } }], usage: {} }) } } }
        return runSubAgentLoop('Fixture system', 'Commit the approved change.', runContext.taskId, [tool], { provider: 'local', localModel: 'fixture' }, 'fixture', {
          client: client as any, callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['read_file'] } },
          context: session!.toolContext({ taskId: runContext.taskId, signal: runContext.signal, permissionProfile: 'coordinator-integrator' }),
        })
      })
      const completion = task.awaitResult()
      const waitForBlock = async (attempt: number) => {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline && !(task.status().state === 'blocked' && task.status().attempt === attempt)) await Bun.sleep(10)
        expect(task.status().state).toBe('blocked')
        expect(task.status().attempt).toBe(attempt)
      }
      await waitForBlock(1)
      const request = session.registry.mailbox.list('coordinator', 'pending')[0]!
      expect(request.payload.gitVersion).toEqual({ root, digest: expect.stringMatching(/^[a-f0-9]{64}$/) })
      let requestId = request.messageId
      if (scenario === 'changed' || scenario === 'denied') await git(['config', 'user.name', 'Changed Mailbox Author'])
      if (scenario === 'legacy') {
        requestId = session.registry.mailbox.send({ senderId: task.taskId, recipientId: 'coordinator', taskId: task.taskId, type: 'permission', payload: { tool: 'git', args, reason: 'Legacy request without identity' } }).message.messageId
      }
      session.registry.sendMessage(task.taskId, 'permission', { decision: scenario === 'denied' ? 'deny' : 'allow', tool: 'git', requestId })
      expect(task.resume()).toBe(true)
      if (scenario === 'changed' || scenario === 'legacy') {
        await waitForBlock(2)
        expect(executions).toBe(0)
        expect(session.registry.mailbox.list('coordinator', 'processed').some(message => message.messageId === requestId)).toBe(true)
        expect(session.registry.mailbox.list(task.taskId, 'processed')).toHaveLength(1)
        if (scenario === 'changed') expect(session.registry.mailbox.list('coordinator', 'pending')).toHaveLength(1)
        const fresh = session.registry.mailbox.list('coordinator', 'pending').find(message => message.messageId !== requestId && message.messageId !== request.messageId)!
        expect(fresh.payload.gitVersion).toBeDefined()
        session.registry.sendMessage(task.taskId, 'permission', { decision: 'allow', tool: 'git', requestId: fresh.messageId })
        expect(task.resume()).toBe(true)
      }
      expect((await completion).status).toBe('done')
      expect(executions).toBe(scenario === 'denied' ? 0 : 1)
    } finally { await session?.shutdown(); await rm(root, { recursive: true, force: true }) }
  }, 15_000)
}

it('refuses a worker Git mutation without an owning workspace', async () => {
  let executions = 0
  let requests = 0
  let observation = ''
  const tool: Tool = { name: 'git', description: 'Git fixture', parameters: { type: 'object', properties: { action: { type: 'string' } } }, execute: async () => { executions++; return 'executed' } }
  const client = { chat: { completions: { create: async (request: any) => {
    observation = request.messages.find((message: any) => message.role === 'tool')?.content ?? ''
    return { choices: [{ message: ++requests === 1 ? { content: null, tool_calls: [{ id: 'unowned', type: 'function', function: { name: 'git', arguments: '{"action":"commit"}' } }] } : { content: 'Fixture complete.' } }], usage: {} }
  } } } }
  await runSubAgentLoop('Fixture system', 'Commit the approved change.', 'unowned-git', [tool], { provider: 'local', localModel: 'fixture' }, 'fixture', {
    client: client as any, callbacks: { permissionPolicy: 'isolated', permissions: { allow: ['git'] } },
  })
  expect(executions).toBe(0)
  expect(observation).toContain('owning workspace context')
})
