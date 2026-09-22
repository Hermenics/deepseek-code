import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { BatchLoader } from '../src/batchLoader'

/** A wrong implementation can leave a caller waiting forever; fail the check instead of hanging it. */
function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('call did not settle')), ms))])
}

function scripted(responses: Array<(keys: string[]) => Promise<Array<string | Error>>>) {
  const batches: string[][] = []
  const loader = new BatchLoader<string, string>((keys) => {
    batches.push(keys)
    const next = responses[batches.length - 1]
    if (!next) throw new Error(`unexpected batch #${batches.length}`)
    return next(keys)
  })
  return { loader, batches }
}

it('rejects every caller in a batch whose batch function rejects', async () => {
  const { loader, batches } = scripted([async () => { throw new Error('db down') }])
  const outcomes = await Promise.allSettled([within(loader.load('a')), within(loader.load('b')), within(loader.load('a'))])
  expect(batches).toEqual([['a', 'b']])
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected')
    expect((outcome as PromiseRejectedResult).reason?.message).toBe('db down')
  }
})

it('fetches again after a failed batch instead of replaying the failure', async () => {
  const { loader, batches } = scripted([
    async (keys) => keys.map((k) => k.toUpperCase()),
    async () => { throw new Error('db down') },
    async (keys) => keys.map((k) => k.toUpperCase()),
  ])
  expect(await within(loader.load('a'))).toBe('A')
  await Promise.allSettled([within(loader.load('b')), within(loader.load('c'))])
  // Only the keys of the failed batch are fetched again; the earlier success stays cached.
  expect(await within(loader.loadMany(['a', 'b', 'c']))).toEqual(['A', 'B', 'C'])
  expect(batches).toEqual([['a'], ['b', 'c'], ['b', 'c']])
})

it('retries only the key that failed and keeps the others cached', async () => {
  const { loader, batches } = scripted([
    async () => ['A', new Error('no such user')],
    async (keys) => keys.map((k) => k.toUpperCase()),
  ])
  const first = await Promise.allSettled([within(loader.load('a')), within(loader.load('b'))])
  expect(first[0]).toEqual({ status: 'fulfilled', value: 'A' })
  expect((first[1] as PromiseRejectedResult).reason?.message).toBe('no such user')

  expect(await within(loader.loadMany(['a', 'b']))).toEqual(['A', 'B'])
  expect(batches).toEqual([['a', 'b'], ['b']])
})

it('still batches and caches successful loads', async () => {
  const { loader, batches } = scripted([async (keys) => keys.map((k) => `v-${k}`)])
  expect(await within(loader.loadMany(['x', 'y', 'x']))).toEqual(['v-x', 'v-y', 'v-x'])
  expect(await within(loader.load('y'))).toBe('v-y')
  expect(batches).toEqual([['x', 'y']])
})

it('adds tests for failed batches', () => {
  const tests = readdirSync('.', { recursive: true })
    .map(String)
    .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file) && !file.includes('__eval_check__') && !file.includes('node_modules'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  expect(tests).toMatch(/reject|throw|Error\(/)
})
