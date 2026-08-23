import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent } from '../src/agent/agent.js'
import { printOutput } from './platform-commands.js'

const callbacks = () => ({
  onToken() {}, onThinking() {}, onToolCall() {}, onToolResult() {}, onDone() {}, onDenyAbort() {}, onAutoCompact() {},
})

describe('agent authorization', () => {
  it('returns unexpected execution failures as one tool result', async () => {
    const agent = new Agent({ provider: 'local', localModel: 'test-model' })
    await (agent as any).readyPromise
    ;(agent as any).settings = { risk: { enabled: false } }
    ;(agent as any).executeTool = async () => { throw new Error('executor exploded') }
    const events: string[] = []
    const lifecycleEvents: string[] = []
    const unsubscribe = agent.orchestrator.events.subscribe(event => {
      if (event.type === 'tool_started' || event.type === 'tool_finished') lifecycleEvents.push(event.type)
    })
    const result = await (agent as any).checkAndExecuteTool(
      { id: 'unexpected', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      { path: 'README.md' },
      {
        ...callbacks(),
        onToolCall: () => events.push('call'),
        onToolResult: (_name: string, value: string) => events.push(`result:${value}`),
      },
    )

    expect(result.result).toBe('Error: executor exploded')
    expect(events).toEqual(['call', 'result:Error: executor exploded'])
    expect(lifecycleEvents).toEqual(['tool_started', 'tool_finished'])
    unsubscribe()
  })

  it('authorizes hook-modified arguments and fails closed without a confirmation handler', async () => {
    const agent = new Agent({ provider: 'local', localModel: 'test-model' })
    await (agent as any).readyPromise
    let executed = false
    ;(agent as any).executeTool = async () => { executed = true; return 'executed' }
    ;(agent as any).settings = {
      permissions: { deny: ['Shell(blocked *)'] },
      hooks: { PreToolUse: [{ matcher: 'shell', hooks: [{ type: 'command', command: printOutput('{"modified_input":{"command":"blocked now"}}') }] }] },
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

  it('binds workflow consent to the script after hooks rewrite it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-workflow-consent-'))
    const agent = new Agent({ provider: 'local', localModel: 'test-model' }, { projectRoot: root, logFile: null, snapshotFile: null })
    try {
      await agent.readyPromise
      agent.interactionMode = 'build'
      const rewritten = 'export const meta = {"name":"rewritten"}; return 2;'
      const hookOutput = JSON.stringify({ modified_input: { script: rewritten } })
      ;(agent as any).settings = {
        hooks: { PreToolUse: [{ matcher: 'workflow', hooks: [{ type: 'command', command: printOutput(hookOutput) }] }] },
        risk: { enabled: false }, workflows: { enabled: true },
      }
      ;(agent as any).executeTool = async () => 'executed'
      let approvedScript = ''
      agent.setToolPermissionHandler(async request => {
        approvedScript = String((request.args as Record<string, unknown>).script)
        return 'once'
      })
      const call = { id: 'workflow-hook', type: 'function', function: { name: 'workflow', arguments: '{}' } }
      const result = await (agent as any).checkAndExecuteTool(call, {
        script: 'export const meta = {"name":"original"}; return 1;',
      }, callbacks())

      expect(result.result).toBe('executed')
      expect(approvedScript).toBe(rewritten)
    } finally {
      await agent.shutdown()
      await rm(root, { recursive: true, force: true })
    }
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
      const blocked = await (agent as any).checkAndExecuteTool(call, { path: external, content: 'escape' }, callbacks())
      expect(blocked.result).toMatch(/^Error: .*outside the task workspace/)
      expect(await agent.undo()).toBe('Nothing to undo.')
      const directory = join(root, 'directory')
      await mkdir(directory)
      const invalidTarget = await (agent as any).checkAndExecuteTool(call, { path: directory, content: 'escape' }, callbacks())
      expect(invalidTarget.result).toMatch(/^Error: /)
      expect(await agent.undo()).toBe('Nothing to undo.')
    } finally {
      await agent.shutdown()
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
    }
  })

  it('validates write_plan without rejecting its internal plan path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-agent-plan-root-'))
    const agent = new Agent({ provider: 'local', localModel: 'test-model' }, { projectRoot: root, snapshotFile: null })
    const planPath = join(root, 'plan.md')
    try {
      await agent.readyPromise
      const result = await (agent as any).executeTool('write_plan', { content: '# Plan', __planFilePath: planPath })
      expect(result).toContain('Plan written')
      expect(await readFile(planPath, 'utf8')).toBe('# Plan')

      const invalid = await (agent as any).executeTool('write_plan', { content: '# Plan', extra: true, __planFilePath: planPath })
      expect(invalid).toContain('must NOT have additional properties')
    } finally {
      await agent.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })
})
