Create `src/lru.ts` exporting `class LRUCache<K, V>`:

- `constructor(capacity: number, ttlMs?: number, now: () => number = Date.now)`. Throw a `RangeError` when `capacity` is less than 1.
- `set(key, value)` inserts or updates an entry, marks it most recently used, and evicts the least recently used entry when the cache is over capacity.
- `get(key)` returns the value and marks the entry most recently used, or returns `undefined` when the key is missing.
- `has(key)` reports whether a live entry exists without changing recency.
- `delete(key)` removes an entry and returns whether it existed.
- `size` is a getter with the number of live entries.
- When `ttlMs` is given, an entry expires `ttlMs` after it was last set. Expired entries behave as missing everywhere and are removed when encountered.

Add tests for it.
