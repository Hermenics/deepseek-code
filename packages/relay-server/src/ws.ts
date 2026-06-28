import type { ServerWebSocket } from 'bun'
import { sessions, attachSocket, getSession, route, closeSession } from './sessions.js'
import type { EncryptedEnvelope } from '../../remote-shared/src/types.js'
import type { Role } from './sessions.js'
import { loadConfig } from './config.js'

export interface WSData {
  sessionId: string
  role: Role
}

const config = loadConfig()

// rate limit: sessionId -> { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(sessionId)
  if (!entry || now - entry.windowStart >= 1000) {
    rateLimitMap.set(sessionId, { count: 1, windowStart: now })
    return true
  }
  entry.count++
  return entry.count <= config.rateLimit.messagesPerSecond
}

export const wsHandler = {
  open(ws: ServerWebSocket<WSData>) {
    const { sessionId, role } = ws.data
    const session = getSession(sessionId)
    if (!session) {
      ws.close(4004, 'Session not found')
      return
    }
    attachSocket(sessionId, role, ws as unknown as WebSocket)
  },

  message(ws: ServerWebSocket<WSData>, raw: string | Buffer) {
    const { sessionId } = ws.data
    if (!checkRateLimit(sessionId)) {
      ws.close(4029, 'Rate limit exceeded')
      return
    }
    try {
      const envelope = JSON.parse(raw.toString()) as EncryptedEnvelope
      if (!envelope.sessionId) return
      route(envelope, ws.data.role)
    } catch {
      // malformed — drop
    }
  },

  close(ws: ServerWebSocket<WSData>) {
    rateLimitMap.delete(ws.data.sessionId)
  },
}

// Ping all connected sockets every heartbeatIntervalMs to detect stale connections
setInterval(() => {
  for (const s of sessions.values()) {
    const cli = s.cliSocket as unknown as ServerWebSocket<WSData> | null
    const mobile = s.mobileSocket as unknown as ServerWebSocket<WSData> | null
    try { cli?.ping() } catch { closeSession(s.sessionId, 'ping_failed') }
    try { mobile?.ping() } catch { closeSession(s.sessionId, 'ping_failed') }
  }
}, config.session.heartbeatIntervalMs)
