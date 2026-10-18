import { describe, expect, it } from 'bun:test'
import { mapSettledBounded } from '../src/agent/boundedBatch.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('mapSettledBounded', () => {
  it('preserves input order while keeping only the configured number of workers active', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<number>())
    const started = Array.from({ length: 5 }, () => deferred<void>())
    const activeByIndex = new Array<number>(5)
    let active = 0
    let peak = 0
    const resultsPromise = mapSettledBounded([0, 1, 2, 3, 4], 2, async (value) => {
      active++
      peak = Math.max(peak, active)
      activeByIndex[value] = active
      started[value]!.resolve()
      try {
        return await gates[value]!.promise
      } finally {
        active--
      }
    })

    await Promise.all([started[0]!.promise, started[1]!.promise])
    gates[1]!.resolve(10)
    await started[2]!.promise
    gates[0]!.resolve(0)
    await started[3]!.promise
    gates[3]!.resolve(30)
    await started[4]!.promise
    gates[2]!.resolve(20)
    gates[4]!.resolve(40)

    const results = await resultsPromise
    expect(peak).toBe(2)
    expect(activeByIndex).toEqual([1, 2, 2, 2, 2])
    expect(results).toEqual([0, 10, 20, 30, 40].map(value => ({ status: 'fulfilled', value })))
  })

  it('records each failure and continues running later items', async () => {
    const failure = new Error('worker failed')
    const rejection = new Error('worker rejected')
    const calls: number[] = []
    const results = await mapSettledBounded([0, 1, 2, 3, 4], 2, value => {
      calls.push(value)
      if (value === 1) throw failure
      if (value === 3) return Promise.reject(rejection)
      return value * 2
    })

    expect(calls).toEqual([0, 1, 2, 3, 4])
    expect(results).toEqual([
      { status: 'fulfilled', value: 0 },
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: 4 },
      { status: 'rejected', reason: rejection },
      { status: 'fulfilled', value: 8 },
    ])
  })

  it('rejects a non-positive or non-integer concurrency limit', async () => {
    await expect(mapSettledBounded([1], 0, value => value)).rejects.toThrow('concurrency')
    await expect(mapSettledBounded([1], 1.5, value => value)).rejects.toThrow('concurrency')
  })
})
