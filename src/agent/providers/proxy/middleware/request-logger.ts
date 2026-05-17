import type { MiddlewareHandler } from 'hono'
import { log } from '../config.js'

export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    await next()
    const ms = Date.now() - start
    const status = c.res.status
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    log(level, `${c.req.method} ${c.req.path} ${status} ${ms}ms`)
  }
}
