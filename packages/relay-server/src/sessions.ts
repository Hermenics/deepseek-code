import type { EncryptedEnvelope } from '../../remote-shared/src/types.js'

export type SessionState = 'pairing' | 'active' | 'closed'
export type Role = 'cli' | 'mobile'

export interface SessionEntry {
  sessionId: string
  cliId: string
  cliPublicKey: string
  state: SessionState
  createdAt: number
  lastActivity: number
  cliSocket: WebSocket | null
  mobileSocket: WebSocket | null
}

export const sessions = new Map<string, SessionEntry>()

export function createSession(sessionId: string, cliId: string, cliPublicKey: string): SessionEntry {
  const entry: SessionEntry = {
    sessionId,
    cliId,
    cliPublicKey,
    state: 'pairing',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    cliSocket: null,
    mobileSocket: null,
  }
  sessions.set(sessionId, entry)
  return entry
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId)
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function touchSession(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (s) s.lastActivity = Date.now()
}

export function attachSocket(sessionId: string, role: Role, ws: WebSocket): void {
  const s = sessions.get(sessionId)
  if (!s) return
  if (role === 'cli') s.cliSocket = ws
  else s.mobileSocket = ws
}

export function route(envelope: EncryptedEnvelope, fromRole: Role): void {
  const s = sessions.get(envelope.sessionId)
  if (!s) return
  touchSession(envelope.sessionId)
  const target = fromRole === 'cli' ? s.mobileSocket : s.cliSocket
  if (target?.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify(envelope))
  }
}

export function closeSession(sessionId: string, reason: string): void {
  const s = sessions.get(sessionId)
  if (!s) return
  s.cliSocket?.close(1000, reason)
  s.mobileSocket?.close(1000, reason)
  sessions.delete(sessionId)
}

export function purgeExpired(maxIdleMs: number): void {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > maxIdleMs) {
      closeSession(id, 'timeout')
    }
  }
}
