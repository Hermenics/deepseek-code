import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { TLSSocket } from 'node:tls'
import { connect as tcpConnect, createServer as tcpServer, isIP, type Socket } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { classifyUrl, isLoopbackHost, systemResolver, type Resolver } from './policy.js'
import type { EgressCertificate, EgressLaunchOptions, EgressAuthorizer } from './egress.js'

const HOP_HEADERS = ['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade']
function headersWithoutHops(headers: IncomingMessage['headers']): IncomingMessage['headers'] {
  const result = { ...headers }
  const extra = String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase())
  for (const name of [...HOP_HEADERS, ...extra]) delete result[name]
  return result
}
function bareHost(host: string): string { return host.replace(/^\[|\]$/g, '').replace(/\.$/, '') }

/** One authenticated proxy per browser context; no direct/tunnel fallback. */
export class EgressEngine {
  readonly username = 'codimium'
  readonly password = randomBytes(32).toString('hex')
  readonly realm = randomBytes(16).toString('hex')
  private readonly authorization = Buffer.from(`Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`)
  private readonly sockets = new Set<Duplex>()
  private readonly tunnel = new WeakMap<Duplex, URL>()
  private readonly authenticated = new WeakSet<Duplex>()
  private readonly server = createServer()
  private readonly inner = createServer()
  private readonly innerTls = tcpServer(socket => this.acceptTls(socket))
  private readonly privateDirectory = mkdtempSync(join(tmpdir(), 'deepseek-egress-tls-'))
  private stopped = false
  private _url = ''

  private constructor(private certificate: EgressCertificate, private authorize: EgressAuthorizer, private resolve: Resolver, private certificateAuthority?: string) {
    this.inner.setTimeout(30_000)
    for (const server of [this.server, this.inner]) {
      server.maxHeadersCount = 100
      server.headersTimeout = 15_000
      server.requestTimeout = 30_000
      server.on('request', (req, res) => { void this.forward(req, res).catch(() => { if (!res.headersSent) res.writeHead(502); res.end() }) })
      server.on('upgrade', (req, socket, head) => { void this.upgrade(req, socket, head).catch(() => socket.destroy()) })
      server.on('connection', socket => this.track(socket))
      server.on('clientError', (_error, socket) => socket.destroy())
    }
    this.server.on('connect', (req, socket, head) => { void this.connect(req, socket, head).catch(() => socket.destroy()) })
  }

  static async start(certificate: EgressCertificate, authorize: EgressAuthorizer, resolve: Resolver = systemResolver, certificateAuthority?: string): Promise<EgressEngine> {
    const gate = new EgressEngine(certificate, authorize, resolve, certificateAuthority)
    try {
      await new Promise<void>((done, fail) => { gate.innerTls.once('error', fail); gate.innerTls.listen(join(gate.privateDirectory, 'tls'), () => { gate.innerTls.off('error', fail); done() }) })
      await new Promise<void>((done, fail) => {
        gate.server.once('error', fail)
        gate.server.listen(0, '127.0.0.1', () => { gate.server.off('error', fail); done() })
      })
      const address = gate.server.address()
      if (!address || typeof address === 'string') { gate.stop(); throw new Error('Codimium network protection did not bind') }
      gate._url = `http://127.0.0.1:${address.port}`
      return gate
    } catch (error) { gate.stop(); throw error }
  }

  get url(): string { return this._url }
  get cleanupDirectory(): string { return this.privateDirectory }
  launchOptions(): EgressLaunchOptions { return { proxyServer: this.url, proxyBypassList: '<-loopback>', certificateSPKI: this.certificate.spki } }
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.server.close()
    this.innerTls.close()
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    rmSync(this.privateDirectory, { recursive: true, force: true })
  }

  private track(socket: Duplex): void {
    this.sockets.add(socket)
    socket.once('close', () => this.sockets.delete(socket))
    socket.on('error', () => socket.destroy())
  }
  private hasAuth(req: IncomingMessage): boolean {
    if (this.authenticated.has(req.socket)) return true
    const actual = Buffer.from(String(req.headers['proxy-authorization'] ?? ''))
    return actual.length === this.authorization.length && timingSafeEqual(actual, this.authorization)
  }
  private challenge(socket: Duplex): void {
    socket.end(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="${this.realm}"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }
  private destination(req: IncomingMessage): URL {
    const tunnel = this.tunnel.get(req.socket)
    const url = tunnel ? new URL(req.url ?? '/', tunnel) : new URL(req.url ?? '')
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported proxy URL')
    if (tunnel && (url.host !== tunnel.host || url.protocol !== tunnel.protocol)) throw new Error('Tunnel authority changed')
    if (tunnel && new URL(`${tunnel.protocol}//${req.headers.host ?? ''}`).host !== tunnel.host) throw new Error('Tunnel Host changed')
    return url
  }
  /** Resolve once, validate every answer, and use that literal for the socket. */
  private async endpoint(url: URL): Promise<{ address: string; family: number }> {
    const httpUrl = new URL(url)
    httpUrl.protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol
    let addresses: string[] = []
    const classification = await classifyUrl(httpUrl.href, async host => { addresses = await this.resolve(host); return addresses })
    if (classification.kind === 'blocked') throw new Error('Blocked egress address')
    const host = bareHost(url.hostname)
    if (isIP(host)) addresses = [host]
    else if (isLoopbackHost(host)) addresses = ['127.0.0.1'] // no DNS for localhost names
    if (!addresses.length) throw new Error('No verified egress address')
    const address = addresses[0]!, family = isIP(address)
    if (!family || address === '127.0.0.1' && Number(url.port) === Number(new URL(this.url).port)) throw new Error('Invalid or recursive egress address')
    return { address, family }
  }
  private async connect(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.stopped) { socket.destroy(); return }
    if (!this.hasAuth(req)) { this.challenge(socket); return }
    const target = new URL(`https://${req.url}`)
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('Invalid CONNECT authority')
    await this.endpoint(target) // never turn CONNECT into an unchecked raw TCP relay
    if (this.stopped) { socket.destroy(); return }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    ;(socket as Socket).setTimeout(10_000, () => socket.destroy())
    const begin = (first: Buffer) => {
      socket.pause()
      ;(socket as Socket).setTimeout(0)
      if (first[0] === 0x16) {
        // Chrome tunnels both ws and wss. TLS goes through the private parser,
        // never to the destination as an opaque uninspected byte stream.
        const peer = tcpConnect(join(this.privateDirectory, 'tls'))
        this.track(peer)
        peer.once('connect', () => peer.write(JSON.stringify({ password: this.password, target: target.href }) + '\n'))
        let acknowledgment = ''
        const acknowledged = (chunk: Buffer) => {
          acknowledgment += chunk.toString()
          if (!'OK\n'.startsWith(acknowledgment)) { peer.destroy(); return }
          if (acknowledgment !== 'OK\n') return
          peer.off('data', acknowledged)
          peer.write(first); socket.pipe(peer); peer.pipe(socket)
        }
        peer.on('data', acknowledged)
        socket.once('close', () => peer.destroy()); peer.once('close', () => socket.destroy())
      } else {
        const authority = new URL(`http://${req.url}`)
        this.authenticated.add(socket); this.tunnel.set(socket, authority)
        socket.unshift(first)
        this.inner.emit('connection', socket)
        socket.resume()
      }
    }
    if (head.length) begin(head)
    else { socket.once('data', begin); socket.resume() }
  }

  private acceptTls(socket: Socket): void {
    this.track(socket)
    socket.setTimeout(5000, () => socket.destroy())
    let metadata = ''
    const read = (chunk: Buffer) => {
      metadata += chunk.toString()
      if (metadata.length > 4096) { socket.destroy(); return }
      if (!metadata.endsWith('\n')) return
      socket.off('data', read)
      try {
        const value = JSON.parse(metadata) as { password?: string; target?: string }
        const actual = Buffer.from(value.password ?? ''), expected = Buffer.from(this.password)
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || typeof value.target !== 'string') throw Error('Unowned TLS bridge')
        const target = new URL(value.target)
        if (target.protocol !== 'https:' || target.username || target.password) throw Error('Invalid TLS authority')
        socket.pause()
        // The bridge waits for this acknowledgment before sending ClientHello,
        // so no TLS bytes are consumed before the native parser owns the socket.
        socket.write('OK\n')
        const secure = new TLSSocket(socket, { isServer: true, secureContext: this.certificate.context, ALPNProtocols: ['http/1.1'] })
        this.track(secure); this.authenticated.add(secure); this.tunnel.set(secure, target)
        secure.setTimeout(15_000, () => secure.destroy())
        secure.once('secure', () => secure.setTimeout(30_000))
        this.inner.emit('connection', secure)
        socket.resume()
      } catch { socket.destroy() }
    }
    socket.on('data', read)
  }
  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.stopped) { res.writeHead(503); res.end(); return }
    if (!this.hasAuth(req)) { res.writeHead(407, { 'proxy-authenticate': `Basic realm="${this.realm}"` }); res.end(); return }
    const url = this.destination(req)
    if (!['http:', 'https:'].includes(url.protocol)) { res.writeHead(400); res.end(); return }
    const endpoint = await this.endpoint(url)
    if (!await this.authorize(url.href) || this.stopped) { res.writeHead(403); res.end(); return }
    const upstream = this.outgoing(req, url, endpoint, false)
    upstream.on('response', response => {
      res.writeHead(response.statusCode ?? 502, headersWithoutHops(response.headers))
      response.on('error', () => res.destroy())
      response.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
  private outgoing(req: IncomingMessage, url: URL, endpoint: { address: string; family: number }, upgrade: boolean) {
    const headers = headersWithoutHops(req.headers)
    headers.host = url.host
    if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket' }
    const secure = ['https:', 'wss:'].includes(url.protocol)
    const send = secure ? httpsRequest : httpRequest
    const upstream = send({
      hostname: bareHost(url.hostname), port: url.port || (secure ? 443 : 80), path: url.pathname + url.search,
      method: req.method, headers, agent: false, rejectUnauthorized: true, ca: this.certificateAuthority,
      // Keep the original hostname for TLS/SNI validation. No second DNS lookup.
      lookup: (_host, options, done) => {
        if (options.all) done(null, [endpoint])
        else done(null, endpoint.address, endpoint.family)
      },
    })
    upstream.setTimeout(30_000, () => upstream.destroy())
    return upstream
  }
  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.stopped) { socket.destroy(); return }
    if (!this.hasAuth(req)) { this.challenge(socket); return }
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket') throw new Error('Unsupported upgrade')
    const url = this.destination(req)
    // Browser WebSocket Origin is immutable to page/worker JS. TLS is terminated
    // locally so the same check applies to wss; opaque/missing origins fail closed.
    const origin = req.headers.origin
    if (typeof origin !== 'string' || !await this.authorize(url.href, origin)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return }
    const endpoint = await this.endpoint(url)
    if (this.stopped) { socket.destroy(); return }
    const upstream = this.outgoing(req, url, endpoint, true)
    upstream.on('upgrade', (response, peer, buffered) => {
      upstream.setTimeout(0)
      peer.setTimeout(0)
      ;(socket as Socket).setTimeout(0)
      this.track(peer)
      if (this.stopped || socket.destroyed) { peer.destroy(); return }
      const headers = headersWithoutHops(response.headers)
      headers.connection = 'Upgrade'; headers.upgrade = 'websocket'
      const lines = Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).filter(value => value !== undefined).map(value => `${name}: ${value}`))
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
      if (buffered.length) socket.write(buffered)
      if (head.length) peer.write(head)
      socket.once('close', () => peer.destroy())
      peer.once('close', () => socket.destroy())
      peer.pipe(socket); socket.pipe(peer)
    })
    upstream.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') })
    upstream.on('error', () => socket.destroy())
    socket.once('close', () => upstream.destroy())
    upstream.end()
  }
}
