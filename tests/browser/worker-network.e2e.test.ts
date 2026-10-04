import { describe, expect, it } from 'bun:test'
import { BrowserService, contextKey } from '../../src/browser/service.js'
import { findChromium } from '../../src/utils/platform.js'
import { launchBrowser } from '../../src/browser/launcher.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const canRun = Boolean(findChromium()) && process.platform !== 'win32'

describe.skipIf(!canRun)('browser worker network policy', () => {
  it('requires fresh approval when a persisted service worker starts before its page', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-worker-restart-'))
    let hits = 0, base = ''
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/probe') { hits++; return new Response('allowed') }
      if (url.pathname === '/persisted.js') return new Response(`
        globalThis.startupProbe = fetch(${JSON.stringify(base + '/probe')}).then(() => false, () => true);
        oninstall = e => e.waitUntil(skipWaiting());
        onactivate = e => e.waitUntil(clients.claim());
      `, { headers: { 'content-type': 'text/javascript' } })
      return new Response('<!doctype html><title>Persisted worker</title>', { headers: { 'content-type': 'text/html' } })
    } })
    base = `http://localhost:${server.port}`
    const key = contextKey('persisted-worker'), profile = join(directory, 'profile')
    const sessions = new Map<string, string>()
    const create = () => new BrowserService((_visible, network) => {
      const browser = launchBrowser({ ...network, profileDirectory: profile })
      browser.connection.on('Target.attachedToTarget', params => {
        const info = params.targetInfo as { type?: string; targetId: string; url: string }
        if (info.type === 'service_worker' && info.url === base + '/persisted.js') sessions.set(info.targetId, String(params.sessionId))
      })
      return browser
    })
    let service = create()
    const probe = () => service.withTab(key, async tab => {
      const deadline = Date.now() + 5000
      while (!sessions.size && Date.now() < deadline) await Bun.sleep(10)
      expect(sessions.size).toBeGreaterThan(0)
      const response = await tab.cdp.send<{ result: { value?: boolean }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression: 'startupProbe', awaitPromise: true, returnByValue: true }, [...sessions.values()][0])
      expect(response.exceptionDetails).toBeUndefined()
      return response.result.value
    })
    try {
      service.configurePersistent(key, profile)
      await service.withTab(key, async () => {})
      service.approve(key, base)
      await service.withTab(key, async tab => {
        await tab.navigate(base)
        const response = await tab.cdp.send<{ exceptionDetails?: unknown }>('Runtime.evaluate', { expression: `navigator.serviceWorker.register('/persisted.js').then(() => navigator.serviceWorker.ready).then(() => true)`, awaitPromise: true, returnByValue: true }, tab.sessionId)
        expect(response.exceptionDetails).toBeUndefined()
      })
      expect(await probe()).toBe(false)
      expect(hits).toBe(1)
      await service.shutdown(); await service.whenClosed()
      sessions.clear()
      service = create(); service.configurePersistent(key, profile)
      await service.withTab(key, async tab => {
        await tab.cdp.send('ServiceWorker.enable', {}, tab.sessionId)
        await tab.cdp.send('ServiceWorker.startWorker', { scopeURL: base + '/' }, tab.sessionId)
      })
      expect(service.isApproved(key, base)).toBe(false)
      expect(await probe()).toBe(true)
      expect(hits).toBe(1)
      service.approve(key, base)
      await service.withTab(key, async tab => {
        const result = await tab.cdp.send<{ result: { value?: number }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression: `fetch(${JSON.stringify(base + '/probe')}).then(r => r.status)`, awaitPromise: true, returnByValue: true }, [...sessions.values()][0])
        expect(result.exceptionDetails).toBeUndefined()
        expect(result.result.value).toBe(200)
      })
      expect(hits).toBe(2)
      expect(service.status().running).toBe(true)
    } finally { await service.shutdown(); await service.whenClosed(); server.stop(true); await rm(directory, { recursive: true, force: true }) }
  }, 60_000)
  it('keeps owned opaque workers usable without giving them network permission', async () => {
    let hits = 0
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      if (new URL(request.url).pathname === '/probe') hits++
      return new Response('<!doctype html><title>Opaque worker</title>', { headers: { 'content-type': 'text/html' } })
    } })
    const base = `http://localhost:${server.port}`, service = new BrowserService(), key = contextKey('opaque-worker')
    try {
      await service.withTab(key, async () => {})
      service.approve(key, base)
      await service.withTab(key, tab => tab.navigate(base))
      const result = await service.withTab(key, async tab => {
        const code = `let denied = false; try { await fetch(${JSON.stringify(base + '/probe')}); } catch { denied = true; } postMessage({ answer: 6 * 7, denied });`
        const expression = `new Promise((resolve,reject) => {
          const worker = new Worker('data:text/javascript,' + encodeURIComponent(${JSON.stringify(code)}), {type:'module'});
          const timer = setTimeout(() => { worker.terminate(); reject(Error('Opaque worker timed out')); }, 5000);
          worker.onmessage = e => { clearTimeout(timer); worker.terminate(); resolve(e.data); };
          worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(Error(e.message)); };
        })`
        const response = await tab.cdp.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, tab.sessionId)
        expect(response.exceptionDetails).toBeUndefined()
        return response.result.value
      })
      expect(result).toEqual({ answer: 42, denied: true })
      expect(hits).toBe(0)
      expect(service.status().running).toBe(true)
      await service.withTab(key, tab => tab.snapshot())
    } finally { await service.shutdown(); await service.whenClosed(); server.stop(true) }
  }, 30_000)
  for (const persistent of [false, true]) it(`checks page and worker requests in a ${persistent ? 'persistent' : 'disposable'} context`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deepseek-worker-network-'))
    const hits = new Map<string, number>(), allowed = new Set<string>()
    const worker = `async function probe(kind) {
      let denied = false;
      try { await fetch(BLOCKED + '/probe?kind=' + kind, {mode:'no-cors'}); } catch { denied = true; }
      await fetch(ALLOWED + '/allowed?kind=' + kind);
      return {kind, denied};
    }`
    let blocked = ''
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const url = new URL(request.url), kind = url.searchParams.get('kind') ?? ''
      if (url.pathname === '/probe') { hits.set(kind, (hits.get(kind) ?? 0) + 1); return new Response('probe') }
      if (url.pathname === '/allowed') { allowed.add(kind); return new Response('allowed') }
      const code = worker.replace('BLOCKED', JSON.stringify(blocked)).replace('ALLOWED', JSON.stringify(base))
      if (url.pathname === '/worker.js') return new Response(code + `onmessage = async e => postMessage(await probe(e.data));`, { headers: { 'content-type': 'text/javascript' } })
      if (url.pathname === '/nested.js') return new Response(`onmessage = e => { const w = new Worker('/worker.js'); w.onmessage = m => postMessage(m.data); w.postMessage(e.data); };`, { headers: { 'content-type': 'text/javascript' } })
      if (url.pathname === '/shared.js') return new Response(code + `onconnect = e => { const p = e.ports[0]; p.onmessage = async m => p.postMessage(await probe(m.data)); p.start(); };`, { headers: { 'content-type': 'text/javascript' } })
      if (url.pathname === '/service.js') return new Response(code + `oninstall = () => self.skipWaiting(); onactivate = e => e.waitUntil(clients.claim()); onmessage = e => e.waitUntil(probe(e.data).then(result => e.source.postMessage(result)));`, { headers: { 'content-type': 'text/javascript' } })
      return new Response('<!doctype html><title>Worker policy</title><p>Ready</p>', { headers: { 'content-type': 'text/html' } })
    } })
    const base: string = `http://localhost:${server.port}`
    // Linux routes this unspecified IPv4 address to the local listener, but the
    // production policy blocks it. All probes stay on this isolated fixture.
    blocked = `http://0.0.0.0:${server.port}`
    const targets: unknown[] = []
    const service = new BrowserService((_visible, network) => {
      const browser = launchBrowser({ ...network, profileDirectory: persistent ? join(directory, 'profile') : undefined })
      browser.connection.on('Target.attachedToTarget', (params, parent) => targets.push({ info: params.targetInfo, parent }))
      browser.connection.on('Fetch.requestPaused', (params, session) => targets.push({ paused: { requestId: params.requestId, networkId: params.networkId, frameId: params.frameId, resourceType: params.resourceType, url: (params.request as any)?.url }, session }))
      browser.connection.on('Network.requestWillBeSent', (params, session) => targets.push({ network: { requestId: params.requestId, frameId: params.frameId, url: (params.request as any)?.url }, session }))
      return browser
    }), key = contextKey('worker-network')
    try {
      if (persistent) service.configurePersistent(key, join(directory, 'profile'))
      expect((await fetch(blocked + '/probe?kind=fixture')).status).toBe(200)
      hits.clear()
      await service.withTab(key, async () => {})
      service.approve(key, base)
      await service.withTab(key, async tab => { await tab.navigate(base); await service.applyTabPolicy(tab) })
      expect(service.currentUrl(key)).toContain(base)
      const observations: Array<{ kind: string; denied: boolean; allowed: boolean; hits: number }> = []
      const kinds = ['page', 'dedicated', 'blob', 'nested', 'shared', 'service']
      for (const kind of kinds) {
        const result = await service.withTab(key, async tab => {
          const code = worker.replace('BLOCKED', JSON.stringify(blocked)).replace('ALLOWED', JSON.stringify(base))
          const expression = kind === 'page' ? `(async () => { ${code}; return await probe('page'); })()` : `new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Worker did not report: ${kind}')), 7000);
            const done = e => { clearTimeout(timer); resolve(e.data); };
            try {
              ${kind === 'service' ? `navigator.serviceWorker.onmessage = done; await navigator.serviceWorker.register('/service.js'); const registration = await navigator.serviceWorker.ready; registration.active.postMessage('service');`
                : kind === 'shared' ? `const w = new SharedWorker('/shared.js'); w.port.onmessage = done; w.port.start(); w.port.postMessage('shared');`
                  : kind === 'blob' ? `const url = URL.createObjectURL(new Blob([${JSON.stringify(code + `onmessage = async e => postMessage(await probe(e.data));`)}], {type:'text/javascript'})); const w = new Worker(url); w.onmessage = e => { w.terminate(); URL.revokeObjectURL(url); done(e); }; w.postMessage('blob');`
                  : `const w = new Worker('${kind === 'nested' ? '/nested.js' : '/worker.js'}'); w.onmessage = done; w.postMessage('${kind}');`}
            } catch (e) { clearTimeout(timer); reject(e); }
          })`
          const response = await tab.cdp.send<{ result: { value?: { kind: string; denied: boolean } }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, tab.sessionId)
          expect(response.exceptionDetails).toBeUndefined()
          return response.result.value
        })
        expect(result?.kind).toBe(kind)
        observations.push({ kind, denied: result!.denied, allowed: allowed.has(kind), hits: hits.get(kind) ?? 0 })
      }
      expect(observations).toEqual(kinds.map(kind => ({ kind, denied: true, allowed: true, hits: 0 })))
      expect(targets.some(target => String((target as { info?: { url?: string } }).info?.url).startsWith('chrome-extension:'))).toBe(false)
    } catch (error) { throw new Error(`${String(error)}; targets=${JSON.stringify(targets)}`) }
    finally { await service.shutdown(); await service.whenClosed(); server.stop(true); await rm(directory, { recursive: true, force: true }) }
  }, 60_000)
})
