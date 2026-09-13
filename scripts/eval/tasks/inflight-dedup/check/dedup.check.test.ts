import { expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { UserCache, type User } from '../src/userCache'

function controlledFetcher() {
  const calls: string[] = []
  const pending: Array<{ resolve: (user: User) => void; reject: (error: Error) => void }> = []
  const fetcher = (id: string) => {
    calls.push(id)
    return new Promise<User>((resolve, reject) => pending.push({ resolve, reject }))
  }
  return { calls, pending, fetcher }
}

/** A wrong implementation can leave a caller waiting forever; fail the check instead of hanging it. */
function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('call did not settle')), ms))])
}

it('shares one in-flight request between concurrent callers of the same id', async () => {
  const { calls, pending, fetcher } = controlledFetcher()
  const cache = new UserCache(fetcher)
  const results = Promise.all([cache.get('1'), cache.get('1'), cache.get('1')])
  await Promise.resolve()
  expect(calls).toEqual(['1'])
  pending[0]!.resolve({ id: '1', name: 'Ana' })
  const [a, b, c] = await within(results)
  expect(a).toEqual({ id: '1', name: 'Ana' })
  expect(b).toBe(a)
  expect(c).toBe(a)
  await within(cache.get('1'))
  expect(calls).toEqual(['1'])
})

it('does not share requests between different ids', async () => {
  const { calls, pending, fetcher } = controlledFetcher()
  const cache = new UserCache(fetcher)
  const both = Promise.all([cache.get('1'), cache.get('2')])
  await Promise.resolve()
  expect(calls).toEqual(['1', '2'])
  pending[0]!.resolve({ id: '1', name: 'Ana' })
  pending[1]!.resolve({ id: '2', name: 'Bia' })
  expect((await within(both)).map((u) => u.name)).toEqual(['Ana', 'Bia'])
})

it('rejects every waiting caller on failure and retries on the next call', async () => {
  const { calls, pending, fetcher } = controlledFetcher()
  const cache = new UserCache(fetcher)
  // Attach handlers to both callers before the failure, as real callers awaiting get() would;
  // otherwise an async get() wrapper looks like an unhandled rejection.
  const outcomes = Promise.allSettled([within(cache.get('1')), within(cache.get('1'))])
  await Promise.resolve()
  expect(calls).toEqual(['1'])
  pending[0]!.reject(new Error('network down'))
  for (const outcome of await outcomes) {
    expect(outcome.status).toBe('rejected')
    expect((outcome as PromiseRejectedResult).reason?.message).toBe('network down')
  }

  const retry = cache.get('1')
  await Promise.resolve()
  expect(calls).toEqual(['1', '1'])
  pending[1]!.resolve({ id: '1', name: 'Ana' })
  expect((await within(retry)).name).toBe('Ana')
})

it('adds tests for concurrent calls', () => {
  const tests = readdirSync('.', { recursive: true })
    .map(String)
    .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file) && !file.includes('__eval_check__') && !file.includes('node_modules'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  expect(tests).toMatch(/Promise\.all|concurren/i)
})
