import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { BrowserService, contextKey } from '../../src/browser/service.js'
import { diffSnapshots, renderSnapshot } from '../../src/browser/snapshot.js'
import { findChromium } from '../../src/utils/platform.js'
import { launchBrowser, type LaunchedBrowser } from '../../src/browser/launcher.js'
import type { BrowserEgress } from '../../src/browser/egress.js'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
    if (url.pathname === '/login') return html('<p>ok</p><script>localStorage.setItem("language", "English")</script>', { 'set-cookie': 'session=abc; Path=/; HttpOnly' })
    if (url.pathname === '/whoami') return html(`<p id=c>${request.headers.get('cookie') ?? 'anonymous'}</p>`)
    if (url.pathname === '/popup') return html('<h1>Popup</h1>')
    return html(`<h1>Home</h1><button onclick="this.textContent='Saved';console.error('save failed on server')">Save</button>
      <a href="/popup" target="_blank">Open popup</a> <a href="${otherBase}/">Leave</a>`)
  } })
  base = `http://localhost:${app.port}`
})
afterAll(() => { app.stop(true); other.stop(true) })

describe('BrowserService close errors', () => {
  it('reports a close failure once so later browser operations can proceed', async () => {
    const service = new BrowserService()
    const closeError = new Error('persistent state could not be saved')
    const state = service as unknown as { closeError: Error | null }
    state.closeError = closeError
    await expect(service.whenClosed()).rejects.toBe(closeError)
    await expect(service.whenClosed()).resolves.toBeUndefined()
  })
})

describe.skipIf(!canRun)('BrowserService with a real browser', () => {
  it('waits for the original persistent close when shutdown calls overlap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-close-overlap-'))
    const profile = join(directory, 'profile'), key = contextKey('close-overlap')
    let releaseClose!: () => void, announceClose!: () => void
    const held = new Promise<void>(done => { releaseClose = done })
    const started = new Promise<void>(done => { announceClose = done })
    let launched!: LaunchedBrowser
    const service = new BrowserService((visible, network) => {
      launched = launchBrowser({ visible, ...network, profileDirectory: profile })
      const close = launched.close!
      launched.close = async () => { announceClose(); await held; await close() }
      return launched
    })
    try {
      service.configurePersistent(key, profile)
      await service.withTab(key, async () => {})
      service.approve(key, base)
      await service.withTab(key, tab => tab.navigate(`${base}/login`))
      const gates = [...(service as unknown as { egressGates: Set<BrowserEgress> }).egressGates]
      const first = service.shutdown()
      await started
      await Promise.all(gates.map(gate => gate.whenStopped()))
      let secondFinished = false
      const second = service.shutdown().then(() => { secondFinished = true })
      await Bun.sleep(20)
      expect(secondFinished).toBe(false)
      // The held native close is still pending, and Chrome really is still alive.
      expect(await launched.connection.send('Browser.getVersion')).toHaveProperty('product')
      const saved = JSON.parse(await readFile(join(profile, 'deepseek-session.json'), 'utf8'))
      expect(saved.cookies.some((cookie: { name: string }) => cookie.name === 'session')).toBe(true)
      releaseClose()
      await Promise.all([first, second, service.whenClosed()])
      expect(launched.connection.closed).not.toBeNull()
      await expect(launched.connection.send('Browser.getVersion')).rejects.toThrow('closed')
      expect(service.status().running).toBe(false)
    } finally { releaseClose(); await service.shutdown(); await service.whenClosed(); await rm(directory, { recursive: true, force: true }) }
  }, 30_000)
  it('rejects a launcher that ignores the required network settings', async () => {
    const service = new BrowserService(() => launchBrowser())
    try {
      await expect(service.withTab(contextKey('unprotected-launcher'), async () => {})).rejects.toThrow('enable-automation')
      await service.whenClosed()
      expect(service.status().running).toBe(false)
    } finally { await service.shutdown(); await service.whenClosed() }
  }, 30_000)
  it('closes Chrome if its context network helper dies and cleans its private endpoint', async () => {
    const service = new BrowserService(), key = contextKey('network-helper-crash')
    try {
      await service.withTab(key, async () => {})
      const owner = service as unknown as { contexts: Map<string, { egress: BrowserEgress }> }
      const gate = owner.contexts.get(key)!.egress
      const child = gate as unknown as { process: Bun.Subprocess; ready: { cleanupDirectory: string } }
      expect((await stat(child.ready.cleanupDirectory)).mode & 0o777).toBe(0o700)
      child.process.kill('SIGKILL')
      await gate.whenStopped()
      const deadline = Date.now() + 5000
      while (service.status().running && Date.now() < deadline) await Bun.sleep(10)
      expect(service.status().running).toBe(false)
      await service.whenClosed()
      await expect(stat(child.ready.cleanupDirectory)).rejects.toThrow('ENOENT')
    } finally { await service.shutdown(); await service.whenClosed() }
  }, 30_000)
  it('shares one initial tab and context across concurrent first calls', async () => {
    const service = new BrowserService(), key = contextKey('concurrent-first-call')
    try {
      const targets = await Promise.all(Array.from({ length: 3 }, () => service.withTab(key, async tab => tab.targetId)))
      expect(new Set(targets).size).toBe(1)
      expect(service.status().contexts).toHaveLength(1)
      expect(service.status().contexts[0]!.tabs).toHaveLength(1)
    } finally { await service.shutdown(); await service.whenClosed() }
  }, 30_000)
  it('keeps a human-owned browser out of idle shutdown until all holders return it', async () => {
    const service = new BrowserService(), key = contextKey('human-retention')
    // The timer is the authoritative scheduling state; no five-minute sleep is needed.
    const timers = service as unknown as { idleTimer: ReturnType<typeof setTimeout> | null }
    try {
      await service.withTab(key, async () => {})
      expect(timers.idleTimer).not.toBeNull()
      const first = service.retain(key), second = service.retain(key)
      expect(timers.idleTimer).toBeNull()
      await service.withTab(key, tab => tab.snapshot())
      expect(timers.idleTimer).toBeNull()
      first(); first()
      expect(timers.idleTimer).toBeNull()
      second()
      expect(timers.idleTimer).not.toBeNull()
      expect(service.status().running).toBe(true)
    } finally { await service.shutdown(); await service.whenClosed() }
  }, 60_000)
  it('preserves a bot profile across cold launches without sharing session cookies or origin approvals', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-codimium-'))
    const profile = join(directory, 'profile'), key = contextKey('persistent-bot')
    let service = new BrowserService()
    try {
      service.configurePersistent(key, profile)
      await service.withTab(key, async () => {})
      service.approve(key, base)
      await service.withTab(key, async tab => { await tab.navigate(`${base}/login?code=transient`); await tab.settle() })
      const ephemeral = contextKey('persistent-bot', 'reader')
      await service.withTab(ephemeral, async () => {})
      service.approve(ephemeral, base)
      const read = (context: string) => service.withTab(context, async tab => { await tab.navigate(`${base}/whoami`); return renderSnapshot(await tab.snapshot('full')) })
      expect(await read(ephemeral)).toContain('anonymous')
      expect(await read(key)).toContain('session=abc')
      await service.withTab(key, async tab => { await tab.navigate(`${base}/whoami?code=transient`); expect(tab.url).toContain('?code=transient') })
      await service.shutdown()
      await service.whenClosed()
      expect((await stat(profile)).mode & 0o777).toBe(0o700)
      expect((await stat(join(profile, 'deepseek-session.json'))).mode & 0o777).toBe(0o600)
      const saved = JSON.parse(await readFile(join(profile, 'deepseek-session.json'), 'utf8'))
      expect(saved.cookies.some((cookie: { name: string }) => cookie.name === 'session')).toBe(true)
      expect(saved.urls.every((url: string) => !url.includes('?'))).toBe(true)
      service = new BrowserService()
      service.configurePersistent(key, profile)
      await service.withTab(key, async () => {})
      expect(service.isApproved(key, base)).toBe(false)
      expect(service.takeNotes(key).join(' ')).toContain('Previously open pages')
      service.approve(key, base)
      expect(await read(key)).toContain('session=abc')
      await service.shutdown()
      const cache = join(profile, 'deepseek-session.json'), valid = await readFile(cache, 'utf8')
      await writeFile(cache, 'invalid state')
      service = new BrowserService()
      service.configurePersistent(key, profile)
      await expect(service.withTab(key, async () => {})).rejects.toThrow('session state is invalid')
      await service.whenClosed()
      expect(await readFile(cache, 'utf8')).toBe('invalid state')
      await writeFile(cache, valid)
      await service.withTab(key, async () => {})
      service.approve(key, base)
      expect(await read(key)).toContain('session=abc')
      expect(await service.withTab(key, async tab => {
        const result = await tab.cdp.send<{ result: { value: string } }>('Runtime.evaluate', { expression: 'localStorage.getItem("language")', returnByValue: true }, tab.sessionId)
        return result.result.value
      })).toBe('English')
      const beforeCrash = await readFile(join(profile, 'deepseek-session.json'), 'utf8')
      process.kill(service.status().pid!, 'SIGKILL')
      const deadline = Date.now() + 5000
      while (service.status().running && Date.now() < deadline) await Bun.sleep(50)
      expect(service.status().running).toBe(false)
      await service.whenClosed()
      expect(await readFile(join(profile, 'deepseek-session.json'), 'utf8')).toBe(beforeCrash)
      await service.withTab(key, async () => {})
      expect(service.isApproved(key, base)).toBe(false)
      service.approve(key, base)
      expect(await read(key)).toContain('session=abc')
    } finally { await service.shutdown(); await service.whenClosed(); await rm(directory, { recursive: true, force: true }) }
  }, 60_000)

  it('navigates an approved origin, reports action diffs, follows popups and refuses unapproved origins', async () => {
    let launched: LaunchedBrowser | undefined
    const targets: unknown[] = []
    const service = new BrowserService((_visible, network) => {
      launched = launchBrowser(network)
      launched.connection.on('Target.attachedToTarget', (params, parent) => targets.push({ info: params.targetInfo, parent }))
      return launched
    })
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
      const tabs = service.status().contexts.find(context => context.key === key)?.tabs
      if (!tabs) throw new Error(`Browser closed: ${launched?.connection.closed}; targets=${JSON.stringify(targets)}`)
      expect(tabs).toHaveLength(2)
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
