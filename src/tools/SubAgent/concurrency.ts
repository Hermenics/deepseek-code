import { MAX_CONCURRENT_AGENTS } from '../../constants/tools.js'

let running = 0
let limit = MAX_CONCURRENT_AGENTS
const queue: Array<{ resolve: () => void }> = []

/**
 * Acquire a slot. Resolves immediately if under the cap,
 * otherwise queues and resolves when a slot frees up.
 */
export async function acquire(): Promise<void> {
  if (running < limit) {
    running++
    return
  }
  return new Promise<void>(resolve => queue.push({ resolve }))
}

/**
 * Release a slot. If anything is queued, immediately grants it the slot.
 */
export function release(): void {
  if (running === 0) return
  running--
  if (running >= limit) return
  const next = queue.shift()
  if (!next) return
  running++
  next.resolve()
}

/**
 * Current number of active agents (for monitoring/logging).
 */
export function getRunningCount(): number {
  return running
}

/**
 * Current queue depth (for monitoring/logging).
 */
export function getQueueDepth(): number {
  return queue.length
}

export function setConcurrencyLimit(value: number): void {
  limit = Math.max(1, Math.min(10, Math.trunc(value)))
  while (queue.length > 0 && running < limit) {
    running++
    queue.shift()!.resolve()
  }
}

export function getConcurrencyLimit(): number {
  return limit
}
