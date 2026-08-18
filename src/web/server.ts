import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import XTERM_CSS from '@xterm/xterm/css/xterm.css' with { type: 'text' }
import XTERM_JS from '@xterm/xterm/lib/xterm.js' with { type: 'text' }
import { WebBridge, type WebAgent } from './bridge.js'
import { CLIENT_APP } from './clientApp.js'
import { CLIENT_STYLES } from './clientStyles.js'
import { parseClientCommand, type ClientCommand, type ServerEvent, type SessionStats, type SourceControlSnapshot } from './protocol.js'
import { changeStaging, commitStaged, getSourceControl } from './sourceControl.js'
import { WebTerminal } from './terminal.js'

export interface WebServerOptions {
  agent: WebAgent
  sessionId: string
  model: string
  cwd: string
  port?: number
  hostname?: string
}

export interface WebServerHandle {
  url: string
  port: number
  token: string
  stop(): void
}

interface Socket {
  send(data: string): void
  close(): void
  readyState: number
}

const OPEN = 1
const NO_STORE = { 'Cache-Control': 'no-store' }
// DeepSeek Code serves no remote content: lock the page down to same-origin
// scripts, styles and WebSockets as defense-in-depth against injected markup.
const CSP = { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'" }
const NOSNIFF = { 'X-Content-Type-Options': 'nosniff' }
// WebSocket frames are JSON commands capped by the protocol validator; reject
// oversized frames before parsing so a hostile page cannot burn CPU on the loop.
const MAX_WS_MESSAGE_CHARS = 1_000_000
const DSC_LOGO = Bun.file(new URL('../../website/public/dsc-logo.png', import.meta.url))
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4d6bfe" d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.365 5.365 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078.253.253 0 0 1-.114-.358c.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"/></svg>'

function page(token: string): string {
  const encodedToken = encodeURIComponent(token)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>DeepSeek Code</title><link rel="icon" type="image/png" href="/dsc-logo.png?token=${encodedToken}"><link rel="stylesheet" href="/xterm.css?token=${encodedToken}"><link rel="stylesheet" href="/app.css?token=${encodedToken}"></head><body><div id="app"></div><script src="/xterm.js?token=${encodedToken}"></script><script src="/app.js?token=${encodedToken}"></script></body></html>`
}

/** Constant-time token match; hashing both sides keeps lengths comparable. */
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const providedHash = createHash('sha256').update(provided).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(providedHash, expectedHash)
}

/**
 * DNS-rebinding defense: a page served from a rebinding domain would reach this
 * loopback port with a foreign Host header. Only loopback origins may talk.
 */
export function isLocalHost(host: string | null, port: number): boolean {
  if (!host) return false
  const normalized = host.toLowerCase()
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}` || normalized === `[::1]:${port}`
}

function fallbackSourceControl(): SourceControlSnapshot {
  return { repository: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [], diff: '', stagedDiff: '' }
}

function emptyStats(): SessionStats {
  return { tokenCount: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, contextUsage: 0, contextLimit: 0, toolCalls: 0, filesModified: 0, costUsd: 0 }
}

function randomLocalPort(): number {
  // Bun 1.3 on this Linux runtime rejects port 0 rather than assigning an
  // ephemeral port. Pick from the unprivileged ephemeral range and retry below.
  return 32_768 + Math.floor(Math.random() * 20_000)
}

export function startWebServer(options: WebServerOptions): WebServerHandle {
  const requestedPort = options.port ?? Number(process.env.DEEPSEEK_WEB_PORT ?? 4321)
  const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 4321
  const hostname = options.hostname ?? '127.0.0.1'
  const token = randomUUID()
  const sockets = new Set<Socket>()
  const initializedSockets = new Set<Socket>()
  const pendingCommands = new Map<Socket, ClientCommand[]>()
  const journal: ServerEvent[] = []
  let sequence = 0
  const JOURNAL_LIMIT = 300

  const replayable = (event: ServerEvent): boolean => event.type !== 'terminal_data' && event.type !== 'terminal_exit' && event.type !== 'heartbeat'
  const record = (event: ServerEvent): ServerEvent => {
    const sequenced = { ...event, seq: ++sequence }
    if (replayable(sequenced)) {
      journal.push(sequenced)
      if (journal.length > JOURNAL_LIMIT) journal.splice(0, journal.length - JOURNAL_LIMIT)
    }
    return sequenced
  }
  const sendEvent = (socket: Socket, event: ServerEvent) => {
    if (socket.readyState === OPEN) socket.send(JSON.stringify(event))
  }

  const broadcast = (event: ServerEvent) => {
    const sequenced = record(event)
    const data = JSON.stringify(sequenced)
    for (const socket of sockets) if (socket.readyState === OPEN) socket.send(data)
  }
  let selectedPath: string | undefined
  const sourceControl = async (path = selectedPath): Promise<SourceControlSnapshot> => {
    try { return await getSourceControl(options.cwd, path) } catch { return fallbackSourceControl() }
  }
  const broadcastSourceControl = async (path?: string) => {
    if (path !== undefined) selectedPath = path
    broadcast({ type: 'source_control', snapshot: await sourceControl() })
  }
  const terminal = new WebTerminal(options.cwd, broadcast)
  const bridge = new WebBridge(options.agent, { send: broadcast }, { onWorkspaceChanged: () => { void broadcastSourceControl() } })
  const heartbeat = setInterval(() => {
    broadcast({ type: 'heartbeat', at: Date.now() })
    bridge.sendStats()
  }, 5_000)

  const handleMessage = (socket: Socket, raw: unknown) => {
    if (typeof raw !== 'string' && !(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) return
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    if (text.length > MAX_WS_MESSAGE_CHARS) return
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return }
    const command = parseClientCommand(parsed)
    if (!command) return
    if (!initializedSockets.has(socket)) {
      pendingCommands.set(socket, [...(pendingCommands.get(socket) ?? []), command])
      return
    }
    dispatchCommand(socket, command)
  }

  const dispatchCommand = (socket: Socket, command: ClientCommand) => {
    switch (command.type) {
      case 'refresh_source_control':
        if (command.path !== undefined) selectedPath = command.path
        void (async () => socket.send(JSON.stringify({ type: 'source_control', snapshot: await sourceControl() } satisfies ServerEvent)))()
        return
      case 'stage_files':
      case 'unstage_files':
        void (async () => {
          try {
            await changeStaging(options.cwd, command.type === 'stage_files' ? 'stage' : 'unstage', command.paths)
            await broadcastSourceControl()
          } catch (error) {
            if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies ServerEvent))
          }
        })()
        return
      case 'commit':
        void (async () => {
          try {
            const output = await commitStaged(options.cwd, command.message)
            broadcast({ type: 'commit_result', message: command.message, output })
            await broadcastSourceControl()
          } catch (error) {
            if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies ServerEvent))
          }
        })()
        return
      case 'terminal_open': terminal.open(command.cols, command.rows); return
      case 'terminal_input': terminal.input(command.data); return
      case 'terminal_resize': terminal.resize(command.cols, command.rows); return
      case 'terminal_reset': terminal.reset(command.cols, command.rows); return
      case 'terminal_replay':
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: 'terminal_data', data: terminal.snapshot() } satisfies ServerEvent))
        return
      case 'resume':
        const firstAvailable = journal[0]?.seq
        if (firstAvailable !== undefined && command.since < firstAvailable - 1) {
          sendEvent(socket, record({ type: 'session_gap', from: command.since + 1, to: firstAvailable - 1 }))
        }
        for (const event of journal) if ((event.seq ?? 0) > command.since) sendEvent(socket, event)
        return
      default: bridge.handleCommand(command); return
    }
  }

  const sendHello = async (socket: Socket) => {
    const source = await sourceControl()
    if (socket.readyState !== OPEN) return
    const tools = options.agent.getToolInfo?.() ?? []
    socket.send(JSON.stringify({
      type: 'hello', sessionId: options.sessionId, model: options.model, cwd: options.cwd,
      mode: options.agent.interactionMode ?? 'build', tools, sourceControl: source, latestSeq: sequence,
      stats: options.agent.getSessionStats?.() ?? emptyStats(), todos: bridge.todos(),
    } satisfies ServerEvent))
    for (const event of bridge.pendingEvents()) {
      const requestId = 'requestId' in event ? event.requestId : undefined
      const existing = requestId ? journal.findLast((entry) => 'requestId' in entry && entry.requestId === requestId) : undefined
      sendEvent(socket, existing ?? record(event))
    }
    initializedSockets.add(socket)
    const queued = pendingCommands.get(socket) ?? []
    pendingCommands.delete(socket)
    for (const command of queued) dispatchCommand(socket, command)
  }

  const createServer = (listenPort: number) => Bun.serve({
    hostname,
    port: listenPort,
    websocket: {
      open(ws) {
        sockets.add(ws)
        void sendHello(ws)
      },
      close(ws) { sockets.delete(ws); initializedSockets.delete(ws); pendingCommands.delete(ws) },
      message(ws, message) { handleMessage(ws, message) },
    },
    fetch(req, server) {
      const url = new URL(req.url)
      // Per-process token prevents DNS-rebinding pages from operating the local agent;
      // the loopback Host check blocks the rebinding itself.
      if (!isLocalHost(req.headers.get('host'), listenPort)) return new Response('Forbidden', { status: 403, headers: NO_STORE })
      if (!tokenMatches(url.searchParams.get('token'), token)) return new Response('Forbidden', { status: 403, headers: NO_STORE })
      if (url.pathname === '/ws') {
        if (server.upgrade(req)) return undefined
        return new Response('Upgrade failed', { status: 426, headers: NO_STORE })
      }
      if (url.pathname === '/favicon.svg') return new Response(FAVICON, { headers: { ...NO_STORE, ...NOSNIFF, 'Content-Type': 'image/svg+xml' } })
      if (url.pathname === '/dsc-logo.png') return new Response(DSC_LOGO, { headers: { ...NO_STORE, ...NOSNIFF, 'Content-Type': 'image/png' } })
      if (url.pathname === '/') return new Response(page(token), { headers: { ...NO_STORE, ...NOSNIFF, ...CSP, 'Content-Type': 'text/html; charset=utf-8' } })
      if (url.pathname === '/xterm.css') return new Response(XTERM_CSS, { headers: { ...NO_STORE, ...NOSNIFF, 'Content-Type': 'text/css; charset=utf-8' } })
      if (url.pathname === '/xterm.js') return new Response(XTERM_JS, { headers: { ...NO_STORE, ...NOSNIFF, 'Content-Type': 'application/javascript; charset=utf-8' } })
      if (url.pathname === '/app.css') return new Response(CLIENT_STYLES, { headers: { ...NO_STORE, ...NOSNIFF, 'Content-Type': 'text/css; charset=utf-8' } })
      if (url.pathname === '/app.js') return new Response(CLIENT_APP, { headers: { ...NO_STORE, ...NOSNIFF, 'Content-Type': 'application/javascript; charset=utf-8' } })
      return new Response('Not found', { status: 404, headers: NO_STORE })
    },
  })

  let server: ReturnType<typeof Bun.serve> | undefined
  if (port !== 0) {
    server = createServer(port)
  } else {
    let lastError: unknown
    for (let attempt = 0; attempt < 100; attempt++) {
      try { server = createServer(randomLocalPort()); lastError = undefined; break }
      catch (error) { lastError = error }
    }
    if (lastError || !server) throw lastError ?? new Error('Could not allocate a localhost port')
  }

  if (!server || server.port === undefined) throw new Error('Web server did not expose its listening port')
  const actualPort = server.port

  return {
    url: `http://${hostname}:${actualPort}/?token=${token}`,
    port: actualPort,
    token,
    stop() {
      clearInterval(heartbeat)
      bridge.stop()
      terminal.stop()
      for (const socket of sockets) socket.close()
      sockets.clear()
      server.stop(true)
    },
  }
}
