import type { MiddlewareHandler } from 'hono'
import { log } from '../config.js'

export function errorHandler(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next()
    } catch (err: any) {
      const status = err.status || 500
      const message = err.message || 'Internal server error'

      log('error', `${c.req.method} ${c.req.path} → ${status}`, {
        error: message,
        ...(err.stack && { stack: err.stack.split('\n')[1]?.trim() }),
      })

      return c.json({
        error: {
          message,
          type: status >= 500 ? 'server_error' : 'invalid_request_error',
          code: status === 429 ? 'rate_limit_exceeded'
            : status === 401 ? 'authentication_error'
            : status >= 500 ? 'internal_error'
            : 'bad_request',
        },
      }, status)
    }
  }
}
