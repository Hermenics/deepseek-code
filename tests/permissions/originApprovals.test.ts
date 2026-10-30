import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks, type ToolPermissionRequest } from '../../src/agent/agent.js'
import { redactTypedInput } from '../../src/agent/auditLog.js'
import { browserService } from '../../src/browser/service.js'
import { approvalKey, approvalOrigin, resolvePermission } from '../../src/permissions/matcher.js'
import { loadSettingsSnapshot } from '../../src/settings/repository.js'
import { permissionOptions, toolPermissionReason, toolPermissionSummary } from '../../src/ui/App.js'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(os.tmpdir(), 'deepseek-origin-'))
  roots.push(root)
  return root
}
beforeAll(() => { process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests' })
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('origin-scoped approval keys', () => {
  it('keys web_fetch approvals by origin and leaves other tools keyed by name', () => {
    expect(approvalKey('web_fetch', { url: 'https://Docs.Example.com/a?b=1' })).toBe('web_fetch@https://docs.example.com')
    expect(approvalKey('web_fetch', { url: 'not a url' })).toBe('web_fetch')
    expect(approvalKey('shell', { command: 'ls' })).toBe('shell')
    expect(approvalOrigin('read_file', { url: 'https://example.com' })).toBeUndefined()
  })

  it('matches an origin-scoped allow rule against the normalized URL only', () => {
    const permissions = { allow: ['web_fetch(https://example.com/*)'] }
    expect(resolvePermission(permissions, 'web_fetch', { url: 'https://EXAMPLE.com' })).toBe('allow')
    expect(resolvePermission(permissions, 'web_fetch', { url: 'https://example.com/docs/page' })).toBe('allow')
    expect(resolvePermission(permissions, 'web_fetch', { url: 'https://example.com.evil.test/' })).toBe('ask')
  })
})

describe('agent session approvals for web_fetch', () => {
  async function agentWith(decision: 'session' | 'always') {
    const root = await tempRoot()
    const agent = new Agent(undefined, { projectRoot: root, snapshotFile: null })
    await (agent as any).readyPromise
    ;(agent as any).executeTool = async () => 'fetched'
    ;(agent as any).settings.permissions = {}
    const requests: ToolPermissionRequest[] = []
    agent.setToolPermissionHandler(async request => { requests.push(request); return decision })
    return { agent, requests, root }
  }
  const callbacks: AgentCallbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }
  const fetchUrl = (agent: Agent, url: string) => (agent as any).checkAndExecuteTool(
    { id: `call-${url}`, type: 'function', function: { name: 'web_fetch', arguments: JSON.stringify({ url }) } }, { url }, callbacks,
  ) as Promise<{ result: string }>

  it('asks once per origin and never lets one origin approve another', async () => {
    const { agent, requests } = await agentWith('session')
    expect((await fetchUrl(agent, 'https://a.example/one')).result).toBe('fetched')
    expect((await fetchUrl(agent, 'https://a.example/two')).result).toBe('fetched')
    expect(requests).toHaveLength(1)
    await fetchUrl(agent, 'https://b.example/')
    expect(requests).toHaveLength(2)
    expect(agent.getPermissionsInfo().sessionApproved).toEqual(expect.arrayContaining(['web_fetch@https://a.example', 'web_fetch@https://b.example']))
  })

  it('does not persist session decisions for public-page typing or uploads, including batch uploads', async () => {
    const { agent, requests, root } = await agentWith('session')
    await writeFile(join(root, 'report.txt'), 'report contents')
    const internal = agent as any
    const browserTool = internal.toolMap.get('browser')
    const properties = { ...browserTool.parameters.properties }
    properties.steps = {
      ...properties.steps,
      items: {
        ...properties.steps.items,
        properties: {
          ...properties.steps.items.properties,
          ref: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
        },
      },
    }
    internal.toolMap.set('browser', { ...browserTool, parameters: { ...browserTool.parameters, properties } })
    const currentUrl = spyOn(browserService, 'currentUrl').mockReturnValue('https://public.example/page')
    const invoke = (id: string, args: Record<string, unknown>) => internal.checkAndExecuteTool(
      { id, type: 'function', function: { name: 'browser', arguments: JSON.stringify(args) } }, args, callbacks,
    )
    try {
      await invoke('public-type-1', { action: 'type', ref: 'e1', text: 'first' })
      await invoke('public-type-2', { action: 'type', ref: 'e1', text: 'second' })
      await invoke('public-upload', { action: 'upload', ref: 'file-input', paths: ['report.txt'] })
      await invoke('public-batch-upload', { action: 'batch', steps: [{ action: 'upload', ref: 'file-input', paths: ['report.txt'] }] })

      expect(requests.map(request => request.reason)).toEqual(['risk', 'risk', 'risk', 'risk'])
      expect(agent.getPermissionsInfo().sessionApproved).toEqual([])
    } finally {
      currentUrl.mockRestore()
      await agent.shutdown()
    }
  })
})

describe('project settings cannot grant automatic approval', () => {
  it('ignores autoApproveLowRisk in project and local settings but keeps the user value', async () => {
    const cwd = await tempRoot()
    const home = await tempRoot()
    await mkdir(join(cwd, '.deepseek'), { recursive: true })
    await writeFile(join(cwd, '.deepseek', 'settings.json'), JSON.stringify({ permissions: { autoApproveLowRisk: true } }))
    await writeFile(join(cwd, '.deepseek', 'settings.local.json'), JSON.stringify({ permissions: { autoApproveLowRisk: true } }))
    const spy = spyOn(os, 'homedir').mockReturnValue(home)
    try {
      expect((await loadSettingsSnapshot(cwd)).effective.permissions?.autoApproveLowRisk).toBe(false)
      await mkdir(join(home, '.deepseek'), { recursive: true })
      await writeFile(join(home, '.deepseek', 'settings.json'), JSON.stringify({ permissions: { autoApproveLowRisk: true } }))
      const snapshot = await loadSettingsSnapshot(cwd)
      expect(snapshot.effective.permissions?.autoApproveLowRisk).toBe(true)
      expect(snapshot.issues.some(issue => issue.path === 'permissions.autoApproveLowRisk')).toBe(true)
    } finally { spy.mockRestore() }
  })
})

describe('permission prompt', () => {
  it('identifies text and files transmitted by a browser batch', () => {
    const summary = toolPermissionSummary({ toolName: 'browser', args: { action: 'batch', __origin: 'https://example.com', steps: [{ action: 'type', text: 'hello' }, { action: 'upload', paths: ['report.txt'] }] }, reason: 'risk' })
    expect(summary).toContain('hello')
    expect(summary).toContain('report.txt')
  })
  it('shows browser text even if the call also supplies an unused URL', () => {
    const summary = toolPermissionSummary({ toolName: 'browser', args: { action: 'type', url: 'https://example.com', command: 'ignored', text: 'hello', __origin: 'https://actual.example' }, reason: 'risk' })
    expect(summary).toContain('"hello"')
    expect(summary).toContain('https://actual.example')
  })
  it('shows the URL and names the origin an approval covers', () => {
    const request: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://docs.example.com/x' }, reason: 'permission' }
    expect(toolPermissionSummary(request)).toBe('web_fetch → https://docs.example.com/x')
    const labels = permissionOptions(request).map(option => option.label)
    expect(labels).toContain('Allow web_fetch on https://docs.example.com this session')
    expect(labels).toContain('Always allow web_fetch on https://docs.example.com')
    expect(labels).toContain('Deny and stop this turn')
    expect(labels).toContain('Deny this action and continue')
  })

  it('explains mutable upstream contents only for session-approved Git pulls', () => {
    const labels = (request: ToolPermissionRequest) => permissionOptions(request).map(option => option.label)
    expect(labels({ toolName: 'git', args: { action: 'pull' }, reason: 'risk' }))
      .toContain('Allow git pull from the configured upstream this session (remote contents may change)')
    expect(labels({ toolName: 'git', args: { action: 'push' }, reason: 'risk' }))
      .toContain('Do not ask again for this action this session')
    expect(labels({ toolName: 'shell', args: { command: 'pwd' }, reason: 'permission' }))
      .toContain('Allow shell in this project this session')
  })

  it('offers only one-call approval for an interrupted replay', () => {
    const options = permissionOptions({ toolName: 'write_file', args: { path: 'report.txt' }, reason: 'interrupted_replay' })
    expect(options.map(option => option.result)).toEqual(['once', 'reject', 'deny'])
    expect(options.map(option => option.label)).toEqual([
      'Retry this exact action once',
      'Deny this action and continue',
      'Deny and stop this turn',
    ])
    expect(options.some(option => /session|always allow/i.test(option.label))).toBe(false)
  })

  it('offers only one-call approval for high-risk writes and browser transmissions', () => {
    const write: ToolPermissionRequest = {
      toolName: 'write_file', args: { path: 'large.txt', content: 'replacement' }, reason: 'risk', riskDescription: 'Overwrites a large file.',
    }
    const type: ToolPermissionRequest = {
      toolName: 'browser', args: { action: 'type', text: 'submit this form' }, reason: 'risk', riskDescription: 'Typing sends this text to a public page.',
    }
    const uploadBatch: ToolPermissionRequest = {
      toolName: 'browser', args: { action: 'batch', steps: [{ action: 'upload', paths: ['report.txt'] }] }, reason: 'risk', riskDescription: 'Uploading sends these files to a public page.',
    }
    const options = (request: ToolPermissionRequest) => permissionOptions(request)

    for (const request of [write, type, uploadBatch]) {
      expect(options(request).map(option => option.result)).toEqual(['once', 'reject', 'deny'])
      expect(options(request).map(option => option.label)).toEqual([
        'Allow this action once',
        'Deny this action and continue',
        'Deny and stop this turn',
      ])
    }
    expect(toolPermissionReason(write)).toContain('Approval covers this invocation only')
    expect(toolPermissionReason(type)).toContain('Approval covers this invocation only')
    expect(toolPermissionReason(type)).not.toContain('Uploads are sent')
    expect(toolPermissionReason(uploadBatch)).toContain('match the digest captured before confirmation')
    expect(permissionOptions({ toolName: 'write_file', args: { path: 'large.txt' }, reason: 'permission' })
      .map(option => option.label)).toContain('Allow write_file in this project this session')
  })
})

describe('audit redaction of typed input', () => {
  it('replaces typed text with its length, including nested batch steps', () => {
    expect(redactTypedInput({ action: 'batch', steps: [{ action: 'type', ref: 'e1', text: 'hunter2' }, { action: 'fill', fields: [{ ref: 'e2', value: 'abc' }] }] }))
      .toEqual({ action: 'batch', steps: [{ action: 'type', ref: 'e1', text: '[7 chars]' }, { action: 'fill', fields: [{ ref: 'e2', value: '[3 chars]' }] }] })
  })
})
