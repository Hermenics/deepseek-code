import { expect, it } from 'bun:test'
import { SwrCache } from '../src/swrCache'

it('serves a fresh value from the cache', async () => {
  let time = 0
  let calls = 0
  const cache = new SwrCache(async (key) => `${key}-${++calls}`, { ttlMs: 100, maxStaleMs: 1_000, now: () => time })
  expect(await cache.get('a')).toBe('a-1')
  time = 50
  expect(await cache.get('a')).toBe('a-1')
  expect(calls).toBe(1)
})
