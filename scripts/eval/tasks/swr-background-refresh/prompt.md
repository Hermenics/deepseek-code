Change `SwrCache.get` in `src/swrCache.ts` to stale-while-revalidate:

- A value younger than `ttlMs` is returned without fetching.
- A value between `ttlMs` and `maxStaleMs` old is returned immediately while one background refresh runs; calls made during that refresh must not start another one.
- A value older than `maxStaleMs`, or a missing one, is fetched before returning, and concurrent callers share that single request.
- A failed background refresh keeps serving the stale value, and a later call may try again. A failed foreground fetch rejects every waiting caller and caches nothing.

Ages come from the injected `now()` clock. Add tests for this behavior.
