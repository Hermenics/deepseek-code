import { MAX_CONCURRENT_AGENTS } from '../../constants/tools.js'

let running = 0
const queue: Array<{ resolve: () => void }> = []

/**
 * Acquire a slot. Resolves immediately if under the cap,
 * otherwise queues and resolves when a slot frees up.
 */
export async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT_AGENTS) {
    running++
    return
  }
  return new Promise<void>(resolve => queue.push({ resolve }))
}

/**
 * Release a slot. If anything is queued, immediately grants it the slot.
 */
export function release(): void {
  const next = queue.shift()
  if (next) {
    next.resolve()  // running count stays the same (slot transferred)
  } else {
    running--
  }
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
