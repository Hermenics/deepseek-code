import type { MiddlewareHandler } from 'hono'

export function authMiddleware(apiKey: string): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) return next()

    const bearer = c.req.header('Authorization')
    const xApiKey = c.req.header('x-api-key')

    const token = xApiKey || (bearer?.startsWith('Bearer ') ? bearer.slice(7) : null)

    if (!token || token !== apiKey) {
      return c.json({
        error: {
          message: 'Invalid or missing API key. Use Authorization: Bearer or x-api-key header.',
          type: 'authentication_error',
        },
      }, 401)
    }
    await next()
  }
}
