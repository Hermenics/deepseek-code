import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs'

// spyOn is reversible — unlike mock.module which leaks globally and breaks other test files
let spyRead: ReturnType<typeof spyOn>
let spyWrite: ReturnType<typeof spyOn>
let spyMkdir: ReturnType<typeof spyOn>

const originalFetch = globalThis.fetch
let mockFetchImpl: (...args: any[]) => any

beforeEach(() => {
  spyRead = spyOn(fs, 'readFileSync').mockImplementation((() => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }) as any)
  spyWrite = spyOn(fs, 'writeFileSync').mockImplementation((() => undefined) as any)
  spyMkdir = spyOn(fs, 'mkdirSync').mockImplementation((() => undefined) as any)

  mockFetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ version: '0.2.16' }),
  })
  globalThis.fetch = ((...args: any[]) => mockFetchImpl(...args)) as any
})

afterEach(() => {
  spyRead.mockRestore()
  spyWrite.mockRestore()
  spyMkdir.mockRestore()
  globalThis.fetch = originalFetch
})

import { checkForUpdate, dismissVersion, isDismissed } from '../src/utils/update-notifier.js'

const CURRENT_VERSION = '0.2.16'

// ─── checkForUpdate ──────────────────────────────────────────────

describe('checkForUpdate', () => {
  it('should return null when cooldown is active (last check < 1 hour ago)', async () => {
    const now = Date.now()
    spyRead.mockImplementation(((path: any) => {
      if (String(path).includes('cooldown')) return String(now - 30 * 60 * 1000)
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }) as any)

    const result = await checkForUpdate()

    expect(result).toBeNull()
  })

  it('should return null when versions match (no update available)', async () => {
    mockFetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ version: CURRENT_VERSION }),
    })

    const result = await checkForUpdate()

    expect(result).toBeNull()
  })

  it('should return { current, latest } when a newer version exists on registry', async () => {
    mockFetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ version: '0.3.0' }),
    })

    const result = await checkForUpdate()

    expect(result).not.toBeNull()
    expect(result?.current).toBe(CURRENT_VERSION)
    expect(result?.latest).toBe('0.3.0')
  })

  it('should return null when fetch times out (5s)', async () => {
    mockFetchImpl = (_url: any, opts: any) => new Promise((_, reject) => {
      const signal = opts?.signal as AbortSignal | undefined
      if (signal?.aborted) { reject(new Error('AbortError')); return }
      if (signal) {
        signal.addEventListener('abort', () => reject(new Error('AbortError')))
      }
      // Never resolves — relies on AbortController to abort
    })

    const result = await checkForUpdate()

    expect(result).toBeNull()
  }, 10000)

  it('should return null when fetch fails (network error)', async () => {
    mockFetchImpl = () => Promise.reject(new Error('Network error'))

    const result = await checkForUpdate()

    expect(result).toBeNull()
  })

  it('should save cooldown timestamp after successful check', async () => {
    mockFetchImpl = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ version: '0.3.0' }),
    })

    await checkForUpdate()

    expect(spyWrite).toHaveBeenCalled()
    const [, writtenValue] = spyWrite.mock.calls[0] as unknown as [string, string]
    const timestamp = Number(writtenValue)
    expect(timestamp).toBeGreaterThan(0)
    expect(timestamp).toBeLessThanOrEqual(Date.now())
  })
})

// ─── isDismissed ─────────────────────────────────────────────────

describe('isDismissed', () => {
  it('should return false when no dismissal file exists', () => {
    spyRead.mockImplementation((() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }) as any)

    expect(isDismissed('0.3.0')).toBe(false)
  })

  it('should return true when the version matches the dismissed one', () => {
    spyRead.mockImplementation((() => '0.3.0') as any)

    expect(isDismissed('0.3.0')).toBe(true)
  })

  it('should return false when a different version is dismissed (new release)', () => {
    spyRead.mockImplementation((() => '0.3.0') as any)

    expect(isDismissed('0.4.0')).toBe(false)
  })
})

// ─── dismissVersion ──────────────────────────────────────────────

describe('dismissVersion', () => {
  it('should write the version to the dismissal file', () => {
    dismissVersion('0.3.0')

    expect(spyWrite).toHaveBeenCalled()
    const [, writtenValue] = spyWrite.mock.calls[0] as unknown as [string, string]
    expect(writtenValue).toBe('0.3.0')
  })
})
