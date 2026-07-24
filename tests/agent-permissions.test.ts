import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks, type ToolPermissionRequest } from '../src/agent/agent.js'

const roots: string[] = []

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function executeTool(agent: Agent, name: string, args: Record<string, unknown>) {
  const callbacks: AgentCallbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }
  return (agent as any).checkAndExecuteTool({
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }, args, callbacks) as Promise<{ result: string }>
}

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('agent external-path permissions', () => {
  it('keeps a directory approval in-session and only for that directory', async () => {
    const workspace = await tempRoot('deepseek-agent-workspace-')
    const external = await tempRoot('deepseek-agent-external-')
    const sibling = await tempRoot('deepseek-agent-sibling-')
    await writeFile(join(external, 'one.txt'), 'one')
    await writeFile(join(external, 'two.txt'), 'two')
    await mkdir(join(external, 'nested'))
    await writeFile(join(external, 'nested', 'three.txt'), 'three')
    await writeFile(join(sibling, 'blocked.txt'), 'blocked')
    const agent = new Agent(undefined, { projectRoot: workspace, snapshotFile: null })
    await (agent as any).readyPromise
    const requests: ToolPermissionRequest[] = []
    agent.setToolPermissionHandler(async request => {
      requests.push(request)
      return request.externalDirectory === external ? 'directory' : 'deny'
    })

    expect((await executeTool(agent, 'read_file', { path: join(external, 'one.txt') })).result).toContain('one')
    expect((await executeTool(agent, 'read_file', { path: join(external, 'two.txt') })).result).toContain('two')
    expect((await executeTool(agent, 'read_file', { path: join(external, 'nested', 'three.txt') })).result).toContain('three')
    await expect(executeTool(agent, 'read_file', { path: join(sibling, 'blocked.txt') })).rejects.toThrow('deny-abort')
    expect(requests.map(request => request.externalDirectory)).toEqual([external, sibling])
  })

  it('does not persist an allow-once approval', async () => {
    const workspace = await tempRoot('deepseek-agent-workspace-')
    const external = await tempRoot('deepseek-agent-external-')
    const target = join(external, 'once.txt')
    await writeFile(target, 'once')
    const agent = new Agent(undefined, { projectRoot: workspace, snapshotFile: null })
    await (agent as any).readyPromise
    let requests = 0
    agent.setToolPermissionHandler(async () => {
      requests++
      return 'once'
    })

    await executeTool(agent, 'read_file', { path: target })
    await executeTool(agent, 'read_file', { path: target })
    expect(requests).toBe(2)
    expect(await readFile(target, 'utf8')).toBe('once')
  })

  it('restores an external file approved for the session', async () => {
    const workspace = await tempRoot('deepseek-agent-workspace-')
    const external = await tempRoot('deepseek-agent-external-')
    const target = join(external, 'undo.txt')
    await writeFile(target, 'before')
    const agent = new Agent(undefined, { projectRoot: workspace, snapshotFile: null })
    await (agent as any).readyPromise
    agent.setToolPermissionHandler(async () => 'directory')

    await executeTool(agent, 'write_file', { path: target, content: 'after' })
    expect(await readFile(target, 'utf8')).toBe('after')
    expect(await agent.undo()).toBe(`Restored ${target}`)
    expect(await readFile(target, 'utf8')).toBe('before')
  })
})
