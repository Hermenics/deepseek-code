export interface SwrOptions {
  /** Age (ms) up to which a cached value is fresh. */
  ttlMs: number
  /** Age (ms) up to which a stale value may still be served while it refreshes. */
  maxStaleMs: number
  now?: () => number
}

interface Entry<V> {
  value: V
  fetchedAt: number
}

export class SwrCache<V> {
  private entries = new Map<string, Entry<V>>()
  private now: () => number

  constructor(private fetcher: (key: string) => Promise<V>, private options: SwrOptions) {
    this.now = options.now ?? Date.now
  }

  async get(key: string): Promise<V> {
    const entry = this.entries.get(key)
    if (entry && this.now() - entry.fetchedAt < this.options.ttlMs) return entry.value
    const value = await this.fetcher(key)
    this.entries.set(key, { value, fetchedAt: this.now() })
    return value
  }
}
