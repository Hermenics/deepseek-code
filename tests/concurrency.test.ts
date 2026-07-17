import { describe, it, expect, beforeEach } from 'bun:test'
import { acquire, release, getRunningCount, getQueueDepth, setConcurrencyLimit } from '../src/tools/SubAgent/concurrency.js'

// Module-level state is shared across tests in the same process.
// Each test must restore state to 0 running, 0 queued via release().

describe('concurrency semaphore', () => {
  beforeEach(() => {
    // Drain any slots and queued waiters left over from a previous test.
    // Queue entries are resolved by release(), running decrements on release() with empty queue.
    // We over-release safely: extra releases when running=0 and queue empty just decrement to -N,
    // so we only release while running > 0.
    while (getRunningCount() > 0) release()
    setConcurrencyLimit(5)
    // Drain any remaining queue items (if running somehow got stuck)
    // by flushing promises — guarded so this is a no-op when clean
  })

  it('acquire resolves immediately when under the cap', async () => {
    const before = getRunningCount()
    await acquire()
    expect(getRunningCount()).toBe(before + 1)
    release()
  })

  it('release decrements running count', async () => {
    await acquire()
    const before = getRunningCount()
    release()
    expect(getRunningCount()).toBe(before - 1)
  })

  it('getQueueDepth is 0 when under cap', async () => {
    expect(getQueueDepth()).toBe(0)
    await acquire()
    expect(getQueueDepth()).toBe(0)
    release()
  })

  it('fills all 5 slots without queueing', async () => {
    for (let i = 0; i < 5; i++) await acquire()
    expect(getRunningCount()).toBe(5)
    expect(getQueueDepth()).toBe(0)
    for (let i = 0; i < 5; i++) release()
  })

  it('queues a 6th acquire when all 5 slots are taken', async () => {
    for (let i = 0; i < 5; i++) await acquire()

    let resolved = false
    const p = acquire().then(() => { resolved = true })

    // Yield to microtask queue — the promise should still be pending
    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(false)
    expect(getQueueDepth()).toBe(1)

    // Release one slot to unblock the queued acquire
    release()
    await p
    expect(resolved).toBe(true)

    // Cleanup
    for (let i = 0; i < 5; i++) release()
  })

  it('transfers slot directly to queued item on release (running stays at 5)', async () => {
    for (let i = 0; i < 5; i++) await acquire()

    // Queue one waiter
    const p = acquire()
    release() // Transfers slot — running stays 5, queue goes to 0
    await p

    expect(getRunningCount()).toBe(5)
    expect(getQueueDepth()).toBe(0)

    for (let i = 0; i < 5; i++) release()
  })

  it('processes multiple queued items in FIFO order', async () => {
    for (let i = 0; i < 5; i++) await acquire()

    const order: number[] = []
    const promises = [1, 2, 3].map(n =>
      acquire().then(() => { order.push(n) })
    )

    // Yield so all 3 queue up
    await new Promise(r => setTimeout(r, 10))
    expect(getQueueDepth()).toBe(3)

    // Release 3 times to drain the queue
    release()
    release()
    release()

    await Promise.all(promises)
    expect(order).toEqual([1, 2, 3])

    // Cleanup (5 slots still held + 3 transferred = 5 total running)
    for (let i = 0; i < 5; i++) release()
  })

  it('does not wake queued work above a lowered limit', async () => {
    for (let i = 0; i < 5; i++) await acquire()
    let resolved = false
    const queued = acquire().then(() => { resolved = true })

    setConcurrencyLimit(2)
    release(); release(); release()
    await Promise.resolve()
    expect(getRunningCount()).toBe(2)
    expect(getQueueDepth()).toBe(1)
    expect(resolved).toBe(false)

    release()
    await queued
    expect(getRunningCount()).toBe(2)
    release(); release()
  })
})
