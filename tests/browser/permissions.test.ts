import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentCallbacks, type ToolPermissionRequest } from '../../src/agent/agent.js'
import { browserService } from '../../src/browser/service.js'
import { formatBrowserStatus } from '../../src/commands/browser/index.js'
import browserCommand from '../../src/commands/browser/index.js'
import { browserActionKind, browserApprovalKey } from '../../src/permissions/browser.js'
import { approvalKey, resolvePermission } from '../../src/permissions/matcher.js'
import { assessRisk, hasNetworkCapability } from '../../src/permissions/risk.js'
import { toolPermissionSummary } from '../../src/ui/App.js'
import { browserIndicator } from '../../src/ui/layout/StatusBar.js'
import { previewToolCallArgs } from '../../src/ui/messages/toolDisplay.js'

const LOCAL = 'http://localhost:3000'
const SITE = 'https://shop.example.com'

describe('browser permission model', () => {
  it('classifies calls, with a batch as strong as its strongest step', () => {
    expect(browserActionKind({ action: 'snapshot' })).toBe('read')
    expect(browserActionKind({ action: 'navigate', url: LOCAL })).toBe('navigate')
    expect(browserActionKind({ action: 'click', ref: 'e1' })).toBe('interact')
    expect(browserActionKind({ action: 'dialog', accept: false, text: 'ignored' })).toBe('read')
    expect(browserActionKind({ action: 'dialog', accept: true })).toBe('interact')
    expect(browserActionKind({ action: 'dialog', accept: true, text: 'answer' })).toBe('type')
    expect(browserActionKind({ action: 'batch', steps: [{ action: 'click', ref: 'e1' }, { action: 'type', ref: 'e2', text: 'x' }] })).toBe('type')
  })

  it('keys approvals by origin, separating acting on public pages from visiting them', () => {
    expect(browserApprovalKey({ action: 'navigate', url: `${LOCAL}/login` })).toBe(`browser@${LOCAL}`)
    expect(browserApprovalKey({ action: 'click', ref: 'e1', __origin: LOCAL })).toBe(`browser@${LOCAL}`)
    expect(browserApprovalKey({ action: 'click', ref: 'e1', __origin: SITE })).toBe(`browser:interact@${SITE}`)
    expect(approvalKey('browser', { action: 'snapshot', __origin: SITE })).toBe(`browser@${SITE}`)
  })

  it('lets reads through, asks for navigation and actions, and honors origin rules and batches', () => {
    expect(resolvePermission(undefined, 'browser', { action: 'snapshot', __origin: SITE })).toBe('allow')
    expect(resolvePermission({ allow: ['shell(git *)'] }, 'browser', { action: 'logs', __origin: LOCAL })).toBe('allow')
    expect(resolvePermission(undefined, 'browser', { action: 'navigate', url: LOCAL })).toBe('ask')
    expect(resolvePermission({ allow: [`browser(* ${LOCAL}/*)`] }, 'browser', { action: 'click', ref: 'e1', __origin: LOCAL })).toBe('allow')
    expect(resolvePermission({ allow: [`browser(* ${LOCAL}/*)`] }, 'browser', { action: 'navigate', url: `${SITE}/` })).toBe('ask')
    const deny = { deny: ['browser(click *)'] }
    expect(resolvePermission(deny, 'browser', { action: 'batch', __origin: LOCAL, steps: [{ action: 'snapshot' }, { action: 'click', ref: 'e1' }] })).toBe('deny')
  })

  it('treats leaving this machine as network and typing on a public page as transmission', () => {
    expect(hasNetworkCapability('browser', { action: 'navigate', url: SITE })).toBe(true)
    expect(hasNetworkCapability('browser', { action: 'navigate', url: `${LOCAL}/` })).toBe(false)
    expect(hasNetworkCapability('browser', { action: 'batch', steps: [{ action: 'navigate', url: SITE }] })).toBe(true)
    expect(assessRisk('browser', { action: 'type', ref: 'e1', text: 'hi', __origin: SITE }, { isSubAgent: false, recentWriteCount: 0, config: {} })?.matchedRule).toBe('browser:transmit')
    expect(assessRisk('browser', { action: 'type', ref: 'e1', text: 'hi', __origin: LOCAL }, { isSubAgent: false, recentWriteCount: 0, config: {} })).toBeNull()
  })
})

describe('agent gates for browser calls', () => {
  const roots: string[] = []
  beforeAll(() => { process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests' })
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

  async function setup(currentUrl: string | undefined, decision: 'once' | 'session' = 'session') {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-browser-gates-'))
    roots.push(root)
    const agent = new Agent(undefined, { projectRoot: root, snapshotFile: null })
    await (agent as any).readyPromise
    ;(agent as any).settings.permissions = {}
    const executed: Record<string, unknown>[] = []
    ;(agent as any).executeTool = async (_name: string, args: Record<string, unknown>) => { executed.push(args); return 'ok' }
    const requests: ToolPermissionRequest[] = []
    agent.setToolPermissionHandler(async request => { requests.push(request); return decision })
    const spy = spyOn(browserService, 'currentUrl').mockReturnValue(currentUrl)
    const cb: AgentCallbacks = { onToken() {}, onToolCall() {}, onToolResult() {}, onDone() {} }
    const call = (args: Record<string, unknown>) => (agent as any).checkAndExecuteTool({ id: 'c', type: 'function', function: { name: 'browser', arguments: JSON.stringify(args) } }, args, cb)
    return { requests, executed, call, restore: () => spy.mockRestore() }
  }

  it('asks once per local origin to navigate, then reads and acts there without asking', async () => {
    const { requests, executed, call, restore } = await setup(`${LOCAL}/`)
    try {
      await call({ action: 'navigate', url: `${LOCAL}/login` })
      await call({ action: 'navigate', url: `${LOCAL}/other` })
      await call({ action: 'snapshot' })
      await call({ action: 'click', ref: 'e3' })
      expect(requests).toHaveLength(1)
      expect(executed.at(-1)).toMatchObject({ action: 'click', __origin: LOCAL })
      await call({ action: 'navigate', url: 'http://localhost:5173/' })
      expect(requests).toHaveLength(2)
    } finally { restore() }
  })

  it('asks separately to act on a public page and every time something new is typed there', async () => {
    const { requests, call, restore } = await setup(`${SITE}/cart`)
    try {
      await call({ action: 'click', ref: 'e1' })
      await call({ action: 'click', ref: 'e2' })
      expect(requests.map(request => request.reason)).toEqual(['permission'])
      await call({ action: 'type', ref: 'e4', text: 'first' })
      await call({ action: 'type', ref: 'e4', text: 'second' })
      expect(requests.filter(request => request.reason === 'risk')).toHaveLength(2)
      expect(toolPermissionSummary(requests.at(-1)!)).toBe(`browser → type "second" on ${SITE}`)
    } finally { restore() }
  })
})

describe('browser TUI helpers', () => {
  it('previews the action and target without typed text', () => {
    expect(previewToolCallArgs('browser', { action: 'navigate', url: 'http://localhost:3000/login' })).toBe('navigate localhost:3000/login')
    expect(previewToolCallArgs('browser', { action: 'type', ref: 'e4', text: 'secret' })).toBe('type e4')
    expect(previewToolCallArgs('browser', { action: 'batch', steps: [{}, {}, {}] })).toBe('batch 3 steps')
  })

  it('shows the active host, tabs and visibility for this session only', () => {
    const status = { visible: true, contexts: [{ key: 's|main', active: 1, tabs: [{ url: 'about:blank' }, { url: 'http://localhost:3000/x' }] }, { key: 'other|main', active: 0, tabs: [{ url: 'https://a.test/' }] }] }
    expect(browserIndicator(status, 's|main')).toEqual({ host: 'localhost:3000', tabs: 2, visible: true })
    expect(browserIndicator(status, 'none|main')).toBeNull()
  })

  it('parses /browser and reports status', () => {
    expect(browserCommand.parse(['show'])).toEqual({ type: 'browser', action: 'show' })
    expect(browserCommand.parse([])).toEqual({ type: 'browser', action: 'status' })
    expect(browserCommand.parse(['open'])).toMatchObject({ action: 'error' })
    expect(formatBrowserStatus({ running: false, visible: false, contexts: [] }, 'k', false)).toContain('/features browser on')
    const text = formatBrowserStatus({ running: true, visible: false, pid: 7, contexts: [{ key: 'k', active: 0, approved: [LOCAL], tabs: [{ url: `${LOCAL}/`, title: 'App' }] }] }, 'k', true)
    expect(text).toContain('running headless (pid 7)')
    expect(text).toContain(`* 0 ${LOCAL}/ — "App"`)
    expect(text).toContain(`Approved sites: ${LOCAL}`)
  })
})

describe('browser uploads', () => {
  it('treat an upload like typing: file contents leave the machine on a public page', () => {
    const upload = { action: 'upload', ref: 'e4', paths: ['fixtures/cv.pdf'], __origin: 'https://jobs.example.com' }
    expect(browserActionKind(upload)).toBe('type')
    expect(browserApprovalKey(upload)).toBe('browser:interact@https://jobs.example.com')
    const risk = assessRisk('browser', upload, { isSubAgent: false, recentWriteCount: 0, config: {} })
    expect(risk).toMatchObject({ level: 'high', matchedRule: 'browser:transmit', description: 'Uploading sends these files to https://jobs.example.com.' })
    expect(assessRisk('browser', { ...upload, __origin: 'http://localhost:3000' }, { isSubAgent: false, recentWriteCount: 0, config: {} })).toBeNull()
    expect(toolPermissionSummary({ toolName: 'browser', args: upload, reason: 'risk' } as ToolPermissionRequest)).toBe('browser → upload fixtures/cv.pdf on https://jobs.example.com')
  })
})
