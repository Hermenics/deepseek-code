export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
}

function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('crash') || msg.includes('timeout') || msg.includes('network') || msg.includes('unexpected')
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
      const jitter = Math.random() * 500
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt + jitter))
    }
  }
  throw lastError
}
