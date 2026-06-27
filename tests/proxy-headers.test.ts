import { describe, it, expect, beforeEach, mock } from 'bun:test'

// ─────────────────────────────────────────────────────────────────────────────
// Mock do módulo playwright para evitar abertura de browser real.
// O módulo headers.ts dependerá de algum mecanismo de obter a página ativa
// (ex: getBrowserContext ou getActivePage). Mockamos o módulo inteiro.
// ─────────────────────────────────────────────────────────────────────────────

mock.module('../src/agent/providers/proxy/browser/manager.js', () => ({
  getBrowserContext: mock(() => {
    throw new Error('Browser not initialized in test environment')
  }),
  initBrowser: mock(() => Promise.resolve()),
  closeBrowser: mock(() => Promise.resolve()),
}))

// Mock de playwright para garantir que nenhum browser seja lançado
mock.module('playwright', () => ({
  chromium: {
    launch: mock(() => Promise.reject(new Error('playwright mocked — no real browser in tests'))),
  },
}))

// ─────────────────────────────────────────────────────────────────────────────
// Import do módulo sob teste (ainda não existe — todos os testes devem FALHAR)
// ─────────────────────────────────────────────────────────────────────────────

import type { DeepSeekHeaders } from '../src/agent/providers/proxy/browser/headers.js'

// Importação dinâmica para capturar o módulo após os mocks serem aplicados
const headersModule = await import('../src/agent/providers/proxy/browser/headers.js').catch(
  () => null,
)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getExport(name: string): unknown {
  if (!headersModule) return undefined
  return (headersModule as Record<string, unknown>)[name]
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Exports do módulo
// ─────────────────────────────────────────────────────────────────────────────

describe('proxy/browser/headers', () => {
  describe('module exports', () => {
    it('should export getDeepSeekHeaders as a function', () => {
      const fn = getExport('getDeepSeekHeaders')
      expect(typeof fn).toBe('function')
    })

    it('should export updateSessionParent as a function', () => {
      const fn = getExport('updateSessionParent')
      expect(typeof fn).toBe('function')
    })

    it('should export getSessionParent as a function', () => {
      const fn = getExport('getSessionParent')
      expect(typeof fn).toBe('function')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 2: DeepSeekHeaders interface shape
  // Testa que o retorno de getDeepSeekHeaders respeita o contrato da interface
  // ─────────────────────────────────────────────────────────────────────────

  describe('getDeepSeekHeaders', () => {
    it('should return an object with a headers property', async () => {
      const getDeepSeekHeaders = getExport('getDeepSeekHeaders') as
        | ((forceNew?: boolean) => Promise<DeepSeekHeaders>)
        | undefined

      expect(getDeepSeekHeaders).toBeDefined()

      // A função existe — chamamos com forceNew=false para usar cache se houver.
      // Como o browser está mockado, esperamos que a função lance ou retorne
      // um objeto válido dependendo da implementação. O teste valida o shape.
      const result = await getDeepSeekHeaders!(false).catch(() => null)

      // Se a implementação não existe ainda, result será null e o teste falha
      expect(result).not.toBeNull()
      expect(typeof (result as DeepSeekHeaders).headers).toBe('object')
    })

    it('should return an object with a chatSessionId string property', async () => {
      const getDeepSeekHeaders = getExport('getDeepSeekHeaders') as
        | ((forceNew?: boolean) => Promise<DeepSeekHeaders>)
        | undefined

      expect(getDeepSeekHeaders).toBeDefined()

      const result = await getDeepSeekHeaders!(false).catch(() => null)
      expect(result).not.toBeNull()
      expect(typeof (result as DeepSeekHeaders).chatSessionId).toBe('string')
    })

    it('should return an object with parentMessageId as number or null', async () => {
      const getDeepSeekHeaders = getExport('getDeepSeekHeaders') as
        | ((forceNew?: boolean) => Promise<DeepSeekHeaders>)
        | undefined

      expect(getDeepSeekHeaders).toBeDefined()

      const result = await getDeepSeekHeaders!(false).catch(() => null)
      expect(result).not.toBeNull()

      const { parentMessageId } = result as DeepSeekHeaders
      const isValid = parentMessageId === null || typeof parentMessageId === 'number'
      expect(isValid).toBe(true)
    })

    it('should return headers object containing expected PoW keys', async () => {
      const getDeepSeekHeaders = getExport('getDeepSeekHeaders') as
        | ((forceNew?: boolean) => Promise<DeepSeekHeaders>)
        | undefined

      expect(getDeepSeekHeaders).toBeDefined()

      const result = await getDeepSeekHeaders!(false).catch(() => null)
      expect(result).not.toBeNull()

      const { headers } = result as DeepSeekHeaders
      // O contrato exige pelo menos estas chaves no objeto headers
      expect(Object.keys(headers).length).toBeGreaterThan(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 3: updateSessionParent / getSessionParent
  // Uses a real Map implementation to avoid mock.module leaking from other
  // test files (Bun's mock.module is global per process).
  // ─────────────────────────────────────────────────────────────────────────

  describe('updateSessionParent and getSessionParent', () => {
    const updateSessionParent = getExport('updateSessionParent') as (sessionId: string, parentId: number | null) => void
    const getSessionParent = getExport('getSessionParent') as (sessionId: string) => number | null

    it('should return null for an unknown sessionId', () => {
      const result = getSessionParent('session-that-does-not-exist-xyz')
      expect(result).toBeNull()
    })

    it('should store parentId and return it for the same sessionId', () => {
      const sessionId = 'test-session-store-001'
      updateSessionParent(sessionId, 42)
      expect(getSessionParent(sessionId)).toBe(42)
    })

    it('should return the value set by updateSessionParent (not a stale value)', () => {
      const sessionId = 'test-session-update-002'
      updateSessionParent(sessionId, 10)
      updateSessionParent(sessionId, 99)
      expect(getSessionParent(sessionId)).toBe(99)
    })

    it('should allow storing null as parentId (reset)', () => {
      const sessionId = 'test-session-null-003'
      updateSessionParent(sessionId, 7)
      updateSessionParent(sessionId, null)
      expect(getSessionParent(sessionId)).toBeNull()
    })

    it('should isolate parentId per sessionId (no cross-contamination)', () => {
      const sessionA = 'test-session-isolate-A'
      const sessionB = 'test-session-isolate-B'

      updateSessionParent(sessionA, 100)
      updateSessionParent(sessionB, 200)

      expect(getSessionParent(sessionA)).toBe(100)
      expect(getSessionParent(sessionB)).toBe(200)
    })
  })
})
