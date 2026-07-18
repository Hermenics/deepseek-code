import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'

const callbacks = () => ({
  onToken() {}, onThinking() {}, onToolCall() {}, onToolResult() {}, onDone() {}, onDenyAbort() {}, onAutoCompact() {},
})

describe('agent authorization', () => {
  it('authorizes hook-modified arguments and fails closed without a confirmation handler', async () => {
    const agent = new Agent({ provider: 'local', localModel: 'test-model' })
    await (agent as any).readyPromise
    let executed = false
    ;(agent as any).executeTool = async () => { executed = true; return 'executed' }
    ;(agent as any).settings = {
      permissions: { deny: ['Shell(blocked *)'] },
      hooks: { PreToolUse: [{ matcher: 'shell', hooks: [{ type: 'command', command: `printf '%s' '{"modified_input":{"command":"blocked now"}}'` }] }] },
      risk: { enabled: false },
    }
    const call = { id: 'one', type: 'function', function: { name: 'shell', arguments: '{}' } }
    const denied = await (agent as any).checkAndExecuteTool(call, { command: 'echo safe' }, callbacks())
    expect(denied.result).toContain('blocked by permission rule')
    expect(executed).toBe(false)

    ;(agent as any).settings = { permissions: { allow: ['ReadFile(src/*)'] }, risk: { enabled: false } }
    const askCall = { id: 'two', type: 'function', function: { name: 'read_file', arguments: '{}' } }
    const blocked = await (agent as any).checkAndExecuteTool(askCall, { path: 'README.md' }, callbacks())
    expect(blocked.result).toContain('no confirmation handler')
    expect(executed).toBe(false)

    ;(agent as any).settings = { risk: { enabled: false } }
    ;(agent as any).allowedTools = '*'
    const legacyBlocked = await (agent as any).checkAndExecuteTool(askCall, { path: 'README.md' }, callbacks())
    expect(legacyBlocked.result).toContain('no confirmation handler')
    expect(executed).toBe(false)
  })

  it('includes untracked content in diff review and always completes the turn', async () => {
    const agent = new Agent({ provider: 'local', localModel: 'test-model' })
    await (agent as any).readyPromise
    const file = `.coderabbit-review-${randomUUID()}.txt`
    try {
      await writeFile(file, 'untracked review content\n')
      ;(agent as any).settings = { git: { reviewDiff: true } }
      ;(agent as any).turnModifiedFiles.add(file)
      let review = ''
      let done = false
      agent.setDiffReviewHandler(async value => { review = value; return true })
      await (agent as any).completeTurn({ ...callbacks(), onDone: () => { done = true } })
      expect(review).toContain('/dev/null')
      expect(review).toContain('untracked review content')
      expect(done).toBe(true)

      done = false
      agent.setDiffReviewHandler(async () => { throw new Error('review failed') })
      await expect((agent as any).completeTurn({ ...callbacks(), onDone: () => { done = true } })).rejects.toThrow('review failed')
      expect(done).toBe(true)
    } finally {
      await rm(file, { force: true })
    }
  })

  it('validates write containment before authorization, checkpoint and undo state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-safe-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'deepseek-agent-outside-'))
    const external = join(outside, 'external.txt')
    const agent = new Agent({ provider: 'local', localModel: 'test-model' }, { projectRoot: root, snapshotFile: null })
    try {
      await agent.readyPromise
      ;(agent as any).settings = { risk: { enabled: false }, git: { checkpoint: true } }
      const call = { id: 'escape', type: 'function', function: { name: 'write_file', arguments: '{}' } }
      await expect((agent as any).checkAndExecuteTool(call, { path: external, content: 'escape' }, callbacks())).rejects.toThrow('outside the task workspace')
      expect(await agent.undo()).toBe('Nothing to undo.')
      const directory = join(root, 'directory')
      await mkdir(directory)
      await expect((agent as any).checkAndExecuteTool(call, { path: directory, content: 'escape' }, callbacks())).rejects.toThrow()
      expect(await agent.undo()).toBe('Nothing to undo.')
    } finally {
      await agent.shutdown()
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
    }
  })
})
