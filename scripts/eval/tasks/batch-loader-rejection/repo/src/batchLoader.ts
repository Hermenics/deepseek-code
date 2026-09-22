/** Resolves every key it was given, in order; a per-key failure is returned as an Error in its slot. */
export type BatchFn<K, V> = (keys: K[]) => Promise<Array<V | Error>>

interface QueuedLoad<K, V> {
  key: K
  resolve: (value: V) => void
  reject: (error: Error) => void
}

export class BatchLoader<K, V> {
  private cache = new Map<K, Promise<V>>()
  private queue: QueuedLoad<K, V>[] = []

  constructor(private batchFn: BatchFn<K, V>) {}

  /** Loads one key, batched with the other keys requested in the same tick. */
  load(key: K): Promise<V> {
    const cached = this.cache.get(key)
    if (cached) return cached
    const promise = new Promise<V>((resolve, reject) => {
      this.queue.push({ key, resolve, reject })
      if (this.queue.length === 1) queueMicrotask(() => this.dispatch())
    })
    this.cache.set(key, promise)
    return promise
  }

  /** Loads several keys, in order. */
  loadMany(keys: K[]): Promise<V[]> {
    return Promise.all(keys.map((key) => this.load(key)))
  }

  /** Forgets the cached result for a key. */
  clear(key: K): void {
    this.cache.delete(key)
  }

  /** Sends the queued keys to the batch function and settles each waiting caller. */
  private async dispatch(): Promise<void> {
    const batch = this.queue
    this.queue = []
    const values = await this.batchFn(batch.map((entry) => entry.key))
    batch.forEach((entry, i) => {
      const value = values[i]
      if (value instanceof Error) entry.reject(value)
      else entry.resolve(value as V)
    })
  }
}
