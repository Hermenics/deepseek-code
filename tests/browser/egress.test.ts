import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { request } from 'node:http'
import { connect as tcpConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserEgress, createEgressCertificate, type EgressCertificate } from '../../src/browser/egress.js'
import { BrowserService, contextKey } from '../../src/browser/service.js'
import { findChromium } from '../../src/utils/platform.js'

let identity: EgressCertificate, cert = '', key = ''
beforeAll(async () => {
  identity = await createEgressCertificate()
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-egress-fixture-'))
  try {
    const proc = Bun.spawn(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', join(directory, 'key'), '-out', join(directory, 'cert')], { stdout: 'ignore', stderr: 'ignore' })
    expect(await proc.exited).toBe(0)
    ;[key, cert] = await Promise.all([readFile(join(directory, 'key'), 'utf8'), readFile(join(directory, 'cert'), 'utf8')])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
afterAll(() => { key = ''; cert = '' })

function auth(gate: BrowserEgress): string { return `Basic ${Buffer.from(`${gate.username}:${gate.password}`).toString('base64')}` }
function proxyHttp(gate: BrowserEgress, target: string, credential = auth(gate)): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const upstream = request(gate.url, { path: target, headers: { 'proxy-authorization': credential, connection: 'close' } }, response => {
      let text = ''
      response.on('data', value => { text += value })
      response.on('end', () => resolve({ status: response.statusCode!, text }))
      response.on('error', reject)
    })
    upstream.setTimeout(5000, () => upstream.destroy(Error('Proxy request timed out')))
    upstream.on('error', reject); upstream.end()
  })
}
function proxyTls(gate: BrowserEgress, target: string, socketOrigin?: string, overrideHost?: string): Promise<string> {
  const url = new URL(target), proxy = new URL(gate.url)
  return new Promise((resolve, reject) => {
    const socket = tcpConnect(Number(proxy.port), proxy.hostname)
    const timer = setTimeout(() => { socket.destroy(); reject(Error('TLS proxy timed out')) }, 5000)
    const fail = (error: Error) => { clearTimeout(timer); socket.destroy(); reject(error) }
    socket.on('error', fail)
    let headers = ''
    const handshake = (chunk: Buffer) => {
      headers += chunk.toString()
      if (!headers.includes('\r\n\r\n')) return
      socket.off('data', handshake)
      if (!headers.startsWith('HTTP/1.1 200')) { clearTimeout(timer); socket.destroy(); resolve(headers); return }
      const secure = tlsConnect({ socket, ca: identity.cert, servername: 'codimium.invalid' })
      let result = ''
      secure.on('error', fail)
      secure.on('data', chunk => {
        result += chunk.toString()
        if (socketOrigin !== undefined && result.includes('\r\n\r\n')) { clearTimeout(timer); secure.destroy(); resolve(result) }
      })
      secure.on('end', () => { clearTimeout(timer); resolve(result) })
      secure.once('secureConnect', () => secure.write(`GET ${url.pathname || '/'} HTTP/1.1\r\nHost: ${overrideHost ?? url.host}\r\n${socketOrigin === undefined ? 'Connection: close' : `Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${socketOrigin}`}\r\n\r\n`))
    }
    socket.on('data', handshake)
    socket.once('connect', () => socket.write(`CONNECT ${url.host} HTTP/1.1\r\nHost: ${url.host}\r\nProxy-Authorization: ${auth(gate)}\r\n\r\n`))
  })
}

describe('Codimium egress transport', () => {
  it.skipIf(!findChromium() || process.platform === 'win32')('keeps real Chrome ws/wss working and rejects blocked destinations and opaque creators', async () => {
    let secureBase = ''
    const socketCode = `function openSocket(address) { return new Promise(resolve => {
      const socket = new WebSocket(address), timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 4000);
      socket.onmessage = () => { clearTimeout(timer); socket.close(); resolve('opened'); };
      socket.onerror = () => { clearTimeout(timer); resolve('blocked'); };
    }); }`
    const routes = (req: Request, server: ReturnType<typeof Bun.serve>) => {
      const url = new URL(req.url)
      if (url.pathname === '/socket' && server.upgrade(req, { data: undefined })) return
      const javascript = (code: string) => new Response(code, { headers: { 'content-type': 'text/javascript' } })
      if (url.pathname === '/worker.js') return javascript(socketCode + 'onmessage = async e => postMessage(await openSocket(e.data));')
      if (url.pathname === '/nested.js') return javascript('onmessage = e => { const w = new Worker("/worker.js"); w.onmessage = e => postMessage(e.data); w.postMessage(e.data); };')
      if (url.pathname === '/shared.js') return javascript(socketCode + 'onconnect = e => { const p = e.ports[0]; p.onmessage = async e => p.postMessage(await openSocket(e.data)); p.start(); };')
      if (url.pathname === '/service.js') return javascript(socketCode + 'oninstall = e => e.waitUntil(skipWaiting()); onactivate = e => e.waitUntil(clients.claim()); onmessage = e => e.waitUntil(openSocket(e.data).then(value => e.source.postMessage(value)));')
      return new Response('<!doctype html><title>Socket policy</title>', { headers: { 'content-type': 'text/html' } })
    }
    // Count separately at each real server; no request or browser implementation doubles.
    let plainHits = 0, secureHits = 0
    const plain = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req, server) { return routes(req, server as ReturnType<typeof Bun.serve>) }, websocket: { open(socket) { plainHits++; socket.send('ready') }, message() {} } })
    const secure = Bun.serve({ hostname: '127.0.0.1', port: 0, tls: { key, cert }, fetch(req, server) { return routes(req, server as ReturnType<typeof Bun.serve>) }, websocket: { open(socket) { secureHits++; socket.send('ready') }, message() {} } })
    const base = `http://localhost:${plain.port}`
    secureBase = `https://localhost:${secure.port}`
    const service = new BrowserService(undefined, { certificateAuthority: cert }), context = contextKey('real-sockets')
    const trace: unknown[] = []
    const probe = (destination: string, opaque = false) => service.withTab(context, async tab => {
      const code = `new Promise(resolve => {
        const socket = new WebSocket(${JSON.stringify(destination)});
        const timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 4000);
        socket.onmessage = () => { clearTimeout(timer); socket.close(); resolve('opened'); };
        socket.onerror = () => { clearTimeout(timer); resolve('blocked'); };
      })`
      const expression = opaque ? `new Promise((resolve,reject) => {
        const worker = new Worker('data:text/javascript,' + encodeURIComponent(${JSON.stringify(code + '.then(postMessage)')}));
        worker.onmessage = e => { worker.terminate(); resolve(e.data); }; worker.onerror = e => reject(Error(e.message));
      })` : code
      const response = await tab.cdp.send<{ result: { value?: string }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, tab.sessionId)
      expect(response.exceptionDetails).toBeUndefined()
      return response.result.value
    })
    try {
      await service.withTab(context, async () => {})
      await service.withTab(context, async tab => {
        tab.cdp.on('Network.webSocketFrameError', params => trace.push({ socket: params }))
        tab.cdp.on('Fetch.authRequired', params => trace.push({ challenge: params.authChallenge }))
      })
      service.approve(context, base)
      await service.withTab(context, tab => tab.navigate(base))
      const plainResult = await probe(`ws://localhost:${plain.port}/socket`)
      if (plainResult !== 'opened') throw Error(`Chrome socket=${plainResult}; handshakes=${plainHits}; trace=${JSON.stringify(trace)}`)
      expect(plainResult).toBe('opened')
      expect(await probe(`wss://localhost:${secure.port}/socket`)).toBe('opened')
      expect(plainHits).toBe(1); expect(secureHits).toBe(1)
      for (const kind of ['dedicated', 'blob', 'nested', 'shared', 'service']) {
        for (const [destination, expected] of [
          [`ws://localhost:${plain.port}/socket`, 'opened'], [`wss://localhost:${secure.port}/socket`, 'opened'],
          [`ws://0.0.0.0:${plain.port}/socket`, 'blocked'], [`wss://0.0.0.0:${secure.port}/socket`, 'blocked'],
        ]) {
          const response = await service.withTab(context, async tab => {
            const expression = `new Promise(async (resolve, reject) => {
              const timer = setTimeout(() => reject(Error('Socket worker timed out: ${kind}')), 6000);
              const done = e => { clearTimeout(timer); resolve(e.data); };
              try {
                ${kind === 'service' ? `navigator.serviceWorker.onmessage = done; await navigator.serviceWorker.register('/service.js'); const registration = await navigator.serviceWorker.ready; registration.active.postMessage(${JSON.stringify(destination)});`
                  : kind === 'shared' ? `const w = new SharedWorker('/shared.js'); w.port.onmessage = done; w.port.start(); w.port.postMessage(${JSON.stringify(destination)});`
                    : kind === 'blob' ? `const url = URL.createObjectURL(new Blob([${JSON.stringify(socketCode + 'onmessage = async e => postMessage(await openSocket(e.data));')}], {type:'text/javascript'})); const w = new Worker(url); w.onmessage = e => { w.terminate(); URL.revokeObjectURL(url); done(e); }; w.postMessage(${JSON.stringify(destination)});`
                      : `const w = new Worker('${kind === 'nested' ? '/nested.js' : '/worker.js'}'); w.onmessage = done; w.postMessage(${JSON.stringify(destination)});`}
              } catch (error) { clearTimeout(timer); reject(error); }
            })`
            return tab.cdp.send<{ result: { value?: string }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, tab.sessionId)
          })
          expect(response.exceptionDetails).toBeUndefined()
          expect(response.result.value).toBe(expected)
        }
      }
      expect(plainHits).toBe(6); expect(secureHits).toBe(6)
      expect(await probe(`ws://0.0.0.0:${plain.port}/socket`)).toBe('blocked')
      expect(await probe(`wss://0.0.0.0:${secure.port}/socket`)).toBe('blocked')
      expect(await probe(`ws://localhost:${plain.port}/socket`, true)).toBe('blocked')
      expect(await probe(`wss://localhost:${secure.port}/socket`, true)).toBe('blocked')
      expect(plainHits).toBe(6); expect(secureHits).toBe(6)
      service.approve(context, secureBase)
      await service.withTab(context, tab => tab.navigate(secureBase))
      expect(await probe(`wss://localhost:${secure.port}/socket`)).toBe('opened')
      expect(secureHits).toBe(7)
    } finally { await service.shutdown(); await service.whenClosed(); plain.stop(true); secure.stop(true) }
  }, 60_000)
  it('requires its context credential and removes proxy authentication before forwarding', async () => {
    let observed = '', hits = 0
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) { hits++; observed = req.headers.get('proxy-authorization') ?? ''; return new Response('real upstream') } })
    const gate = await BrowserEgress.start(identity, () => true), target = `http://localhost:${server.port}/`
    try {
      expect((await proxyHttp(gate, target, '')).status).toBe(407)
      expect(hits).toBe(0)
      expect(await proxyHttp(gate, target)).toEqual({ status: 200, text: 'real upstream' })
      expect(hits).toBe(1); expect(observed).toBe('')
      const other = await BrowserEgress.start(identity, () => true)
      try { expect((await proxyHttp(other, target, auth(gate))).status).toBe(407); expect(hits).toBe(1) } finally { other.stop() }
    } finally { gate.stop(); server.stop(true) }
  })
  it('rejects private DNS answers and does not reuse previous public classification', async () => {
    let resolutions = 0, permits = 0
    const gate = await BrowserEgress.start(identity, () => { permits++; return false }, async () => ++resolutions === 1 ? ['93.184.216.34'] : ['127.0.0.1'])
    try {
      expect((await proxyHttp(gate, 'http://changing.invalid/')).status).toBe(403)
      expect(permits).toBe(1)
      expect((await proxyHttp(gate, 'http://changing.invalid/')).status).toBe(502)
      expect(permits).toBe(1); expect(resolutions).toBe(2)
    } finally { gate.stop() }
  })
  it('validates the actual HTTPS server and relays legitimate HTTPS and wss', async () => {
    let hits = 0, sockets = 0
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, tls: { key, cert }, fetch(req, server) {
      if (new URL(req.url).pathname === '/socket' && server.upgrade(req)) return
      hits++; return new Response('verified TLS upstream')
    }, websocket: { open(socket) { sockets++; socket.send('ready') }, message() {} } })
    const target = `https://localhost:${server.port}`, gate = await BrowserEgress.start(identity, (_url, origin) => origin === undefined || origin === target, undefined, cert)
    try {
      const response = await proxyTls(gate, target)
      expect(response).toContain('HTTP/1.1 200'); expect(response).toContain('verified TLS upstream'); expect(hits).toBe(1)
      expect(await proxyTls(gate, target + '/socket', target)).toContain('HTTP/1.1 101')
      expect(sockets).toBe(1)
      expect(await proxyTls(gate, target + '/socket', 'null')).toContain('HTTP/1.1 403')
      expect(sockets).toBe(1)
      expect(await proxyTls(gate, `https://wrong.localhost:${server.port}`)).toContain('HTTP/1.1 502')
      expect(hits).toBe(1)
      let otherHits = 0
      const other = Bun.serve({ hostname: '127.0.0.1', port: 0, tls: { key, cert }, fetch() { otherHits++; return new Response('other authority') } })
      try {
        expect(await proxyTls(gate, target, undefined, `localhost:${other.port}`)).toContain('HTTP/1.1 502')
        expect(otherHits).toBe(0)
      } finally { other.stop(true) }
      const untrusted = await BrowserEgress.start(identity, () => true)
      try {
        expect(await proxyTls(untrusted, target)).toContain('HTTP/1.1 502')
        expect(hits).toBe(1)
      } finally { untrusted.stop() }
    } finally { gate.stop(); server.stop(true) }
  }, 30_000)
})
