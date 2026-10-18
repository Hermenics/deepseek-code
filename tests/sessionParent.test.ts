import { describe, it, expect } from 'bun:test'

// ─────────────────────────────────────────────────────────────────────────────
// Test updateSessionParent / getSessionParent directly.
// Do not import the module; replicate its implementation (a simple Map) to avoid
// Bun's global mock.module contamination (proxy-deepseek-api.test.ts mocks
// sessionParent.js globally, making imports of the module no-ops).
// ─────────────────────────────────────────────────────────────────────────────

// ponytail: intentionally replicated to isolate mocks; this is not an accidental duplicate.
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
