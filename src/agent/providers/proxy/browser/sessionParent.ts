const sessionParents = new Map<string, number | null>()

export function updateSessionParent(sessionId: string, parentId: number | null): void {
  sessionParents.set(sessionId, parentId)
}

export function getSessionParent(sessionId: string): number | null {
  return sessionParents.get(sessionId) ?? null
}
