import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { BrowserService, contextKey } from '../../src/browser/service.js'
import { diffSnapshots, renderSnapshot } from '../../src/browser/snapshot.js'
import { findChromium } from '../../src/utils/platform.js'

const canRun = Boolean(findChromium()) && process.platform !== 'win32'
let app: ReturnType<typeof Bun.serve>
let other: ReturnType<typeof Bun.serve>
let base = ''
let otherBase = ''

beforeAll(() => {
  other = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<h1>Other site</h1>', { headers: { 'content-type': 'text/html' } }) })
  otherBase = `http://127.0.0.1:${other.port}`
  app = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url)
    const html = (body: string, headers: Record<string, string> = {}) => new Response(`<!doctype html><title>${url.pathname}</title>${body}`, { headers: { 'content-type': 'text/html', ...headers } })
    if (url.pathname === '/login') return html('<p>ok</p>', { 'set-cookie': 'session=abc; Path=/' })
    if (url.pathname === '/whoami') return html(`<p id=c>${request.headers.get('cookie') ?? 'anonymous'}</p>`)
    if (url.pathname === '/popup') return html('<h1>Popup</h1>')
    return html(`<h1>Home</h1><button onclick="this.textContent='Saved';console.error('save failed on server')">Save</button>
      <a href="/popup" target="_blank">Open popup</a> <a href="${otherBase}/">Leave</a>`)
  } })
  base = `http://localhost:${app.port}`
})
afterAll(() => { app.stop(true); other.stop(true) })

describe.skipIf(!canRun)('BrowserService with a real browser', () => {
  it('navigates an approved origin, reports action diffs, follows popups and refuses unapproved origins', async () => {
    const service = new BrowserService()
    const key = contextKey('s1')
    try {
      await service.withTab(key, async () => {})
      service.approve(key, base)
      const before = await service.withTab(key, async tab => {
        expect(await tab.navigate(`${base}/`)).toEqual({})
        await service.applyTabPolicy(tab)
        return tab.snapshot()
      })
      expect(renderSnapshot(before)).toContain('button "Save" [e1]')

      const diff = await service.withTab(key, async tab => {
        const point = await tab.pointFor('e1')
        await tab.click(point.x, point.y)
        await tab.settle()
        return diffSnapshots(before, await tab.snapshot())
      })
      expect(diff).toEqual(['~ button "Save" [e1] → button "Saved" [e1]'])
      expect(await service.withTab(key, async tab => tab.drainLogs(true).map(entry => entry.text))).toContain('save failed on server')

      await service.withTab(key, async tab => {
        const snapshot = await tab.snapshot()
        const popupLink = snapshot.lines.find(line => line.text.includes('Open popup'))!
        const point = await tab.pointFor(popupLink.ref!)
        await tab.click(point.x, point.y)
      })
      const popupDeadline = Date.now() + 10_000
      while ((service.status().contexts.find(context => context.key === key)?.tabs.length ?? 0) < 2 && Date.now() < popupDeadline) {
        await Bun.sleep(50)
      }
      expect(service.status().contexts.find(context => context.key === key)?.tabs).toHaveLength(2)
      expect(service.takeNotes(key).join(' ')).toContain('opened a new tab (1)')
      expect(await service.withTab(key, async tab => { await tab.settle(); await tab.refreshInfo(); return tab.url })).toBe(`${base}/popup`)

      service.selectTab(key, 0)
      const blocked = await service.withTab(key, async tab => {
        const snapshot = await tab.snapshot()
        const leave = snapshot.lines.find(line => line.text.includes('Leave'))!
        const point = await tab.pointFor(leave.ref!)
        await tab.click(point.x, point.y)
        await tab.settle()
        return tab.blockedNavigation
      })
      expect(blocked).toBe(`${otherBase}/`)
    } finally {
      service.shutdown()
    }
  }, 60_000)

  it('keeps cookies apart between agents and closes everything with the session', async () => {
    const service = new BrowserService()
    const main = contextKey('s2')
    const sub = contextKey('s2', 'task-1')
    try {
      for (const key of [main, sub]) { await service.withTab(key, async () => {}); service.approve(key, base) }
      await service.withTab(main, tab => tab.navigate(`${base}/login`))
      const read = (key: string) => service.withTab(key, async tab => { await tab.navigate(`${base}/whoami`); return renderSnapshot(await tab.snapshot('full')) })
      expect(await read(main)).toContain('session=abc')
      expect(await read(sub)).toContain('anonymous')
      const pid = service.status().pid!
      service.releaseSession('s2')
      expect(service.status().running).toBe(false)
      // A SIGKILLed process stays a zombie until reaped; give that up to 5s under load.
      const gone = async () => { for (let i = 0; i < 50; i++) { try { process.kill(pid, 0) } catch { return true } await Bun.sleep(100) } return false }
      expect(await gone()).toBe(true)
    } finally {
      service.shutdown()
    }
  }, 60_000)
})
