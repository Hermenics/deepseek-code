import type { MiddlewareHandler } from 'hono'

export function corsMiddleware(origins: string): MiddlewareHandler {
  return async (c, next) => {
    c.header('Access-Control-Allow-Origin', origins)
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version')
    c.header('Access-Control-Max-Age', '86400')

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204)
    }
    await next()
  }
}
