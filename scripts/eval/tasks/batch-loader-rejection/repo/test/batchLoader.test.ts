import { expect, it } from 'bun:test'
import { BatchLoader } from '../src/batchLoader'

it('fetches keys requested in the same tick with one batch call', async () => {
  const batches: number[][] = []
  const loader = new BatchLoader<number, string>(async (keys) => {
    batches.push(keys)
    return keys.map((key) => `user-${key}`)
  })
  expect(await loader.loadMany([1, 2, 3])).toEqual(['user-1', 'user-2', 'user-3'])
  expect(batches).toEqual([[1, 2, 3]])
})

it('serves a loaded key from the cache', async () => {
  let calls = 0
  const loader = new BatchLoader<number, string>(async (keys) => {
    calls++
    return keys.map(String)
  })
  await loader.load(1)
  await loader.load(1)
  expect(calls).toBe(1)
})
