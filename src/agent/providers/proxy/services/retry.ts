import { log } from '../config.js'

export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504
}

function isTransient(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'permanent' in err && (err as { permanent?: boolean }).permanent === true) {
    return false
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('crash') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('unexpected') ||
      msg.includes('fetch failed') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('econnreset') ||
      msg.includes('epipe') ||
      msg.includes('socket hang up') ||
      msg.includes('connection was lost') ||
      msg.includes('aborted') ||
      msg.includes('err_network') ||
      msg.includes('net::')
  }
  return false
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000 } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === maxRetries || !isTransient(err)) throw err
      log('warn', `Retry ${attempt + 1}/${maxRetries}: ${(err as Error).message}`)
      const jitter = Math.random() * 500
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt + jitter))
    }
  }
  throw lastError
}
