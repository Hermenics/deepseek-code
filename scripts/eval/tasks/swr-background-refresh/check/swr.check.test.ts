import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { SwrCache } from '../src/swrCache'

function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('call did not settle')), ms))])
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function controlled() {
  const calls: string[] = []
  const pending: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = []
  const fetcher = (key: string) => {
    calls.push(key)
    return new Promise<string>((resolve, reject) => pending.push({ resolve, reject }))
  }
  return { calls, pending, fetcher }
}

async function primed(opts = { ttlMs: 100, maxStaleMs: 1_000 }) {
  let time = 0
  const c = controlled()
  const cache = new SwrCache(c.fetcher, { ...opts, now: () => time })
  const first = cache.get('k')
  await tick()
  c.pending[0]!.resolve('v1')
  expect(await within(first)).toBe('v1')
  return { ...c, cache, setTime: (t: number) => { time = t } }
}

it('returns a stale value at once and refreshes it once in the background', async () => {
  const s = await primed()
  s.setTime(500)
  expect(await within(s.cache.get('k'))).toBe('v1')
  expect(await within(s.cache.get('k'))).toBe('v1')
  await tick()
  expect(s.calls).toEqual(['k', 'k'])
  s.pending[1]!.resolve('v2')
  await tick()
  expect(await within(s.cache.get('k'))).toBe('v2')
  expect(s.calls).toEqual(['k', 'k'])
})

it('a refreshed value is fresh again from the time it arrived', async () => {
  const s = await primed()
  s.setTime(500)
  await within(s.cache.get('k'))
  await tick()
  s.setTime(550)
  s.pending[1]!.resolve('v2')
  await tick()
  s.setTime(600)
  expect(await within(s.cache.get('k'))).toBe('v2')
  await tick()
  expect(s.calls).toHaveLength(2)
})

it('keeps serving the stale value when a background refresh fails, and retries later', async () => {
  const s = await primed()
  s.setTime(500)
  expect(await within(s.cache.get('k'))).toBe('v1')
  await tick()
  s.pending[1]!.reject(new Error('flaky'))
  await tick()
  expect(await within(s.cache.get('k'))).toBe('v1')
  await tick()
  expect(s.calls).toEqual(['k', 'k', 'k'])
})

it('blocks on a value older than maxStaleMs and shares that fetch', async () => {
  const s = await primed()
  s.setTime(5_000)
  const both = Promise.all([s.cache.get('k'), s.cache.get('k')])
  await tick()
  expect(s.calls).toEqual(['k', 'k'])
  s.pending[1]!.resolve('v3')
  expect(await within(both)).toEqual(['v3', 'v3'])
})

it('rejects every waiter of a failed foreground fetch and caches nothing', async () => {
  const c = controlled()
  const cache = new SwrCache(c.fetcher, { ttlMs: 100, maxStaleMs: 1_000, now: () => 0 })
  const outcomes = Promise.allSettled([within(cache.get('x')), within(cache.get('x'))])
  await tick()
  expect(c.calls).toEqual(['x'])
  c.pending[0]!.reject(new Error('down'))
  for (const o of await outcomes) expect((o as PromiseRejectedResult).reason?.message).toBe('down')
  const retry = cache.get('x')
  await tick()
  expect(c.calls).toEqual(['x', 'x'])
  c.pending[1]!.resolve('ok')
  expect(await within(retry)).toBe('ok')
})

it('adds tests for stale values', () => {
  const tests = readdirSync('.', { recursive: true }).map(String)
    .filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f) && !f.includes('__eval_check__') && !f.includes('node_modules'))
    .map((f) => readFileSync(f, 'utf8')).join('\n')
  expect(tests).toMatch(/stale|maxStale|background/i)
})
