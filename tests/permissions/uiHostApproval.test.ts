import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type ToolPermissionHandler, type ToolPermissionRequest } from '../../src/agent/agent.js'
import { bindToolPermissionPrompt, permissionOptions, type ToolPermissionState } from '../../src/ui/App.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'deepseek-ui-host-approval-'))
  roots.push(root)
  const agent = new Agent({ provider: 'local', localModel: 'fixture' }, { projectRoot: root, logFile: null, snapshotFile: null })
  await agent.readyPromise
  const internal = agent as any
  internal.settings = { permissions: { allow: ['introspect'], deny: [] }, risk: { enabled: false } }
  internal.allowedTools = ['host_approval_probe']
  let executed = 0
  internal.installMcpTools([{
    name: 'host_approval_probe', description: 'Exercise the host permission bridge',
    parameters: { type: 'object', properties: {} },
    execute: async () => { executed++; return 'executed after approval' },
  }])
  let prompt: ToolPermissionState | null = null
  const unbind = bindToolPermissionPrompt(agent, state => { prompt = state })
  const pending = internal.checkAndExecuteTool({
    id: 'host-approval-probe', type: 'function',
    function: { name: 'host_approval_probe', arguments: '{}' },
  }, {}, {
    onToken() {}, onThinking() {}, onToolCall() {}, onToolResult() {}, onDone() {}, onDenyAbort() {}, onAutoCompact() {},
  }) as Promise<{ result: string }>
  for (let attempt = 0; attempt < 100 && !prompt; attempt++) await Bun.sleep(1)
  return { agent, pending, unbind, prompt: () => prompt, executed: () => executed }
}

describe('TUI-to-Agent permission bridge', () => {
  it('queues simultaneous requests and presents the next prompt after the current decision', async () => {
    let handler: ToolPermissionHandler | null = null
    const published: (ToolPermissionState | null)[] = []
    const unbind = bindToolPermissionPrompt({ setToolPermissionHandler: value => { handler = value } }, state => { published.push(state) })
    const firstRequest: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://one.example' }, reason: 'permission' }
    const secondRequest: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://two.example' }, reason: 'permission' }
    try {
      const firstDecision = handler!(firstRequest)
      const firstPrompt = published.at(-1)!
      const secondDecision = handler!(secondRequest)
      expect(published.at(-1)?.request).toEqual(firstRequest)

      firstPrompt.resolve('once')
      expect(published.at(-1)?.request).toEqual(secondRequest)
      published.at(-1)!.resolve('deny')
      expect(await Promise.all([firstDecision, secondDecision])).toEqual(['once', 'deny'])
      expect(published.at(-1)).toBeNull()
    } finally {
      unbind()
    }
  })

  it('stops queued prompts after a denial aborts the turn', async () => {
    let handler: ToolPermissionHandler | null = null
    const published: (ToolPermissionState | null)[] = []
    const unbind = bindToolPermissionPrompt({ setToolPermissionHandler: value => { handler = value } }, state => { published.push(state) })
    const firstRequest: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://one.example' }, reason: 'permission' }
    const secondRequest: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://two.example' }, reason: 'permission' }
    try {
      const firstDecision = handler!(firstRequest)
      const secondDecision = handler!(secondRequest)
      published.at(-1)!.resolve('deny')
      expect(await Promise.all([firstDecision, secondDecision])).toEqual(['deny', 'deny'])
      expect(published.map(state => state?.request ?? null)).toEqual([firstRequest, null])
    } finally {
      unbind()
    }
  })

  it('rejects only the selected action and keeps the next permission prompt', async () => {
    let handler: ToolPermissionHandler | null = null
    const published: (ToolPermissionState | null)[] = []
    const unbind = bindToolPermissionPrompt({ setToolPermissionHandler: value => { handler = value } }, state => { published.push(state) })
    const firstRequest: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://one.example' }, reason: 'permission' }
    const secondRequest: ToolPermissionRequest = { toolName: 'read_file', args: { path: 'notes.txt' }, reason: 'permission' }
    try {
      const firstDecision = handler!(firstRequest)
      const secondDecision = handler!(secondRequest)
      published.at(-1)!.resolve('reject')
      expect(await firstDecision).toBe('reject')
      expect(published.at(-1)?.request).toEqual(secondRequest)

      published.at(-1)!.resolve('once')
      expect(await secondDecision).toBe('once')
      expect(published.at(-1)).toBeNull()
    } finally {
      unbind()
    }
  })

  it('delivers the pending request to the prompt and sends its approval back to the Agent', async () => {
    const state = await setup()
    try {
      expect(state.prompt()?.request).toMatchObject({ toolName: 'host_approval_probe', reason: 'permission' })
      expect(permissionOptions(state.prompt()!.request).map(option => option.result)).toContain('once')
      state.prompt()!.resolve('once')
      expect(await state.pending).toMatchObject({ result: 'executed after approval' })
      expect(state.executed()).toBe(1)
    } finally {
      state.unbind()
      await state.agent.shutdown()
    }
  })

  it('denies an outstanding request when the TUI host unmounts', async () => {
    const state = await setup()
    try {
      expect(state.prompt()?.request.toolName).toBe('host_approval_probe')
      state.unbind()
      await expect(state.pending).rejects.toMatchObject({ message: 'deny-abort' })
      expect(state.executed()).toBe(0)
    } finally {
      state.unbind()
      await state.agent.shutdown()
    }
  })
})
