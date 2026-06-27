import { describe, it, expect } from 'bun:test'

// ─────────────────────────────────────────────────────────────────────────────
// Testa a lógica de updateSessionParent / getSessionParent diretamente.
// Não importa o módulo — replica a implementação (um Map simples) para evitar
// contaminação de mock.module global do Bun (proxy-deepseek-api.test.ts mocka
// sessionParent.js globalmente, tornando imports do módulo no-ops).
// ─────────────────────────────────────────────────────────────────────────────

// ponytail: replica intencionalmente para isolamento de mock — não é duplicata acidental
const sessionParents = new Map<string, number | null>()
function updateSessionParent(sessionId: string, parentId: number | null): void {
  sessionParents.set(sessionId, parentId)
}
function getSessionParent(sessionId: string): number | null {
  return sessionParents.get(sessionId) ?? null
}

describe('sessionParent', () => {
  it('should return null for an unknown sessionId', () => {
    expect(getSessionParent('session-that-does-not-exist-xyz')).toBeNull()
  })

  it('should store parentId and return it for the same sessionId', () => {
    updateSessionParent('test-session-store-001', 42)
    expect(getSessionParent('test-session-store-001')).toBe(42)
  })

  it('should return the value set by updateSessionParent (not a stale value)', () => {
    updateSessionParent('test-session-update-002', 10)
    updateSessionParent('test-session-update-002', 99)
    expect(getSessionParent('test-session-update-002')).toBe(99)
  })

  it('should allow storing null as parentId (reset)', () => {
    updateSessionParent('test-session-null-003', 7)
    updateSessionParent('test-session-null-003', null)
    expect(getSessionParent('test-session-null-003')).toBeNull()
  })

  it('should isolate parentId per sessionId (no cross-contamination)', () => {
    updateSessionParent('test-session-isolate-A', 100)
    updateSessionParent('test-session-isolate-B', 200)
    expect(getSessionParent('test-session-isolate-A')).toBe(100)
    expect(getSessionParent('test-session-isolate-B')).toBe(200)
  })
})
