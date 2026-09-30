import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks, type ToolPermissionRequest } from '../../src/agent/agent.js'
import { redactTypedInput } from '../../src/agent/auditLog.js'
import { approvalKey, approvalOrigin, resolvePermission } from '../../src/permissions/matcher.js'
import { loadSettingsSnapshot } from '../../src/settings/repository.js'
import { permissionOptions, toolPermissionSummary } from '../../src/ui/App.js'

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
    const agent = new Agent(undefined, { projectRoot: await tempRoot(), snapshotFile: null })
    await (agent as any).readyPromise
    ;(agent as any).executeTool = async () => 'fetched'
    ;(agent as any).settings.permissions = {}
    const requests: ToolPermissionRequest[] = []
    agent.setToolPermissionHandler(async request => { requests.push(request); return decision })
    return { agent, requests }
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
  it('shows the URL and names the origin an approval covers', () => {
    const request: ToolPermissionRequest = { toolName: 'web_fetch', args: { url: 'https://docs.example.com/x' }, reason: 'permission' }
    expect(toolPermissionSummary(request)).toBe('web_fetch → https://docs.example.com/x')
    const labels = permissionOptions(request).map(option => option.label)
    expect(labels).toContain('Allow web_fetch on https://docs.example.com this session')
    expect(labels).toContain('Always allow web_fetch on https://docs.example.com')
  })
})

describe('audit redaction of typed input', () => {
  it('replaces typed text with its length, including nested batch steps', () => {
    expect(redactTypedInput({ action: 'batch', steps: [{ action: 'type', ref: 'e1', text: 'hunter2' }, { action: 'fill', fields: [{ ref: 'e2', value: 'abc' }] }] }))
      .toEqual({ action: 'batch', steps: [{ action: 'type', ref: 'e1', text: '[7 chars]' }, { action: 'fill', fields: [{ ref: 'e2', value: '[3 chars]' }] }] })
  })
})
