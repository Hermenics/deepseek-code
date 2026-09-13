import { expect, it } from 'bun:test'
import { UserCache } from '../src/userCache'

it('returns a cached user without fetching again', async () => {
  let calls = 0
  const cache = new UserCache(async (id) => {
    calls++
    return { id, name: 'Ana' }
  })
  await cache.get('1')
  expect((await cache.get('1')).name).toBe('Ana')
  expect(calls).toBe(1)
})
