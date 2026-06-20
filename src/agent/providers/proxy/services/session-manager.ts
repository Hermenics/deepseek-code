import type { Session } from '../types/index.js'

const sessions = new Map<string, Session>()

export function getSession(conversationId: string): Session | undefined {
  return sessions.get(conversationId)
}

export function createSession(conversationId: string, pageId: string, threadUrl: string): Session {
  const session: Session = { conversationId, pageId, threadUrl, createdAt: Date.now() }
  sessions.set(conversationId, session)
  return session
}

export function removeSession(conversationId: string): void {
  sessions.delete(conversationId)
}
