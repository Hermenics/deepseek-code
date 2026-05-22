import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de Playwright — nunca abre browser real nos testes
// ─────────────────────────────────────────────────────────────────────────────

const mockPage = {
  goto: mock(() => Promise.resolve()),
  close: mock(() => Promise.resolve()),
  url: mock(() => 'about:blank'),
}

const mockContext = {
  newPage: mock(() => Promise.resolve(mockPage)),
  close: mock(() => Promise.resolve()),
  pages: mock(() => [mockPage]),
}

const mockBrowser = {
  newContext: mock(() => Promise.resolve(mockContext)),
  close: mock(() => Promise.resolve()),
}

mock.module('playwright', () => ({
  chromium: {
    launchPersistentContext: mock(() => Promise.resolve(mockContext)),
    launch: mock(() => Promise.resolve(mockBrowser)),
  },
}))

// ─────────────────────────────────────────────────────────────────────────────
// Import do módulo sob teste (ainda não existe — todos os testes devem FALHAR)
// ─────────────────────────────────────────────────────────────────────────────

import {
  initPlaywright,
  closePlaywright,
  getActivePage,
  getContext,
  BROWSER_PROFILE_PATH,
} from '../src/agent/providers/proxy/browser/playwright.js'

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('proxy/browser/playwright', () => {
  // ── Contratos de exportação ────────────────────────────────────────────────

  describe('exports', () => {
    it('should export initPlaywright as a function', () => {
      expect(typeof initPlaywright).toBe('function')
    })

    it('should export closePlaywright as a function', () => {
      expect(typeof closePlaywright).toBe('function')
    })

    it('should export getActivePage as a function', () => {
      expect(typeof getActivePage).toBe('function')
    })

    it('should export getContext as a function', () => {
      expect(typeof getContext).toBe('function')
    })

    it('should export BROWSER_PROFILE_PATH as a string', () => {
      expect(typeof BROWSER_PROFILE_PATH).toBe('string')
    })
  })

  // ── BROWSER_PROFILE_PATH ───────────────────────────────────────────────────

  describe('BROWSER_PROFILE_PATH', () => {
    it('should point to ~/.deepseek/browser-profile/', () => {
      const expected = join(homedir(), '.deepseek', 'browser-profile')
      expect(BROWSER_PROFILE_PATH).toBe(expected)
    })

    it('should be an absolute path', () => {
      expect(BROWSER_PROFILE_PATH.startsWith('/')).toBe(true)
    })
  })

  // ── Estado inicial (antes de qualquer init) ────────────────────────────────

  describe('initial state (before init)', () => {
    it('should return null from getActivePage before init', () => {
      expect(getActivePage()).toBeNull()
    })

    it('should return null from getContext before init', () => {
      expect(getContext()).toBeNull()
    })
  })

  // ── initPlaywright ─────────────────────────────────────────────────────────

  describe('initPlaywright', () => {
    let testProfileDir: string

    beforeEach(async () => {
      testProfileDir = await mkdtemp(join(tmpdir(), 'dsk-playwright-test-'))
      // Garante estado limpo antes de cada teste
      await closePlaywright()
    })

    afterEach(async () => {
      await closePlaywright()
      await rm(testProfileDir, { recursive: true, force: true })
    })

    it('should return a Promise (be async)', () => {
      const result = initPlaywright()
      expect(result).toBeInstanceOf(Promise)
      return result
    })

    it('should resolve without throwing when called with no arguments', async () => {
      await expect(initPlaywright()).resolves.toBeUndefined()
    })

    it('should resolve without throwing when headless=true', async () => {
      await expect(initPlaywright(true)).resolves.toBeUndefined()
    })

    it('should resolve without throwing when headless=false', async () => {
      await expect(initPlaywright(false)).resolves.toBeUndefined()
    })

    it('should make getContext return non-null after init', async () => {
      await initPlaywright()
      expect(getContext()).not.toBeNull()
    })

    it('should make getActivePage return non-null after init', async () => {
      await initPlaywright()
      expect(getActivePage()).not.toBeNull()
    })

    it('should not throw when called twice (idempotent)', async () => {
      await initPlaywright()
      await expect(initPlaywright()).resolves.toBeUndefined()
    })
  })

  // ── closePlaywright ────────────────────────────────────────────────────────

  describe('closePlaywright', () => {
    beforeEach(async () => {
      await closePlaywright()
    })

    it('should return a Promise (be async)', () => {
      const result = closePlaywright()
      expect(result).toBeInstanceOf(Promise)
      return result
    })

    it('should resolve without throwing when called before init', async () => {
      await expect(closePlaywright()).resolves.toBeUndefined()
    })

    it('should make getActivePage return null after close', async () => {
      await initPlaywright()
      expect(getActivePage()).not.toBeNull()

      await closePlaywright()
      expect(getActivePage()).toBeNull()
    })

    it('should make getContext return null after close', async () => {
      await initPlaywright()
      expect(getContext()).not.toBeNull()

      await closePlaywright()
      expect(getContext()).toBeNull()
    })

    it('should not throw when called twice (idempotent)', async () => {
      await initPlaywright()
      await closePlaywright()
      await expect(closePlaywright()).resolves.toBeUndefined()
    })
  })

  // ── Ciclo completo init → close → init ────────────────────────────────────

  describe('lifecycle', () => {
    afterEach(async () => {
      await closePlaywright()
    })

    it('should allow re-init after close', async () => {
      await initPlaywright()
      await closePlaywright()
      await initPlaywright()

      expect(getContext()).not.toBeNull()
      expect(getActivePage()).not.toBeNull()
    })

    it('should return null from both getters after full cycle close', async () => {
      await initPlaywright()
      await closePlaywright()

      expect(getActivePage()).toBeNull()
      expect(getContext()).toBeNull()
    })
  })
})
