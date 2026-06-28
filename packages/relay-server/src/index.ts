import { loadConfig } from './config.js'
import { createSession, getSession, closeSession, purgeExpired } from './sessions.js'
import { wsHandler } from './ws.js'
import type { WSData } from './ws.js'
import { randomUUID } from 'node:crypto'

const config = loadConfig()

// Purge idle sessions every 60s
setInterval(() => purgeExpired(config.session.maxIdleMs), 60_000)

Bun.serve<WSData>({
  port: config.port,
  hostname: config.host,

  fetch(req, server) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true })
    }

    // Create session
    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      return req.json().then((body: { cliId: string; publicKey: string }) => {
        const sessionId = randomUUID()
        createSession(sessionId, body.cliId, body.publicKey)
        const wsUrl = `ws://${req.headers.get('host')}/ws?session=${sessionId}`
        return Response.json({ sessionId, wsUrl })
      })
    }

    // Get session info
    if (url.pathname.startsWith('/api/sessions/') && req.method === 'GET') {
      const sessionId = url.pathname.split('/').at(-1) ?? ''
      const s = getSession(sessionId)
      if (!s) return new Response('Not found', { status: 404 })
      return Response.json({ sessionId: s.sessionId, state: s.state, cliPublicKey: s.cliPublicKey })
    }

    // Delete session
    if (url.pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
      const sessionId = url.pathname.split('/').at(-1) ?? ''
      const s = getSession(sessionId)
      if (!s) return new Response('Not found', { status: 404 })
      closeSession(sessionId, 'user_disconnect')
      return new Response(null, { status: 204 })
    }

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const sessionId = url.searchParams.get('session') ?? ''
      const role = url.searchParams.get('role') as 'cli' | 'mobile' | null
      if (!sessionId || (role !== 'cli' && role !== 'mobile')) {
        return new Response('Bad request', { status: 400 })
      }
      const upgraded = server.upgrade(req, { data: { sessionId, role } })
      if (upgraded) return undefined
      return new Response('WebSocket upgrade failed', { status: 500 })
    }

    return new Response('Not found', { status: 404 })
  },

  websocket: wsHandler,
})

console.log(`Relay server running on ${config.host}:${config.port}`)
