import type { MiddlewareHandler } from 'hono'

export function rateLimitMiddleware(limit: number): MiddlewareHandler {
  const window = 60_000
  const requests: number[] = []

  return async (c, next) => {
    const now = Date.now()
    while (requests.length > 0 && requests[0] < now - window) requests.shift()

    if (requests.length >= limit) {
      const retryAfter = Math.ceil((requests[0] + window - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }, 429)
    }

    requests.push(now)
    await next()
  }
}
