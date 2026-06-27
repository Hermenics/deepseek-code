/**
 * Pure queue logic for queued messages feature.
 * All functions are immutable — they never mutate the input array.
 */

export const MAX_QUEUE_SIZE = 10

export function enqueue(queue: string[], msg: string): string[] {
  if (queue.length >= MAX_QUEUE_SIZE) return queue
  return [...queue, msg]
}

export function dequeue(queue: string[]): { next: string | null; remaining: string[] } {
  if (queue.length === 0) return { next: null, remaining: [] }
  const [first, ...rest] = queue
  return { next: first!, remaining: rest }
}

export interface HandleQueueResult {
  /** If set, this note should be passed to agent.addNote() immediately */
  note: string | null
  /** If set, this message should be enqueued via enqueue() */
  queued: string[] | null
}

/**
 * Pure branching logic for handleQueue: detects /msg commands vs normal messages.
 * Extracted from App.tsx so it can be unit-tested without a React environment.
 */
export function handleQueueLogic(msg: string, currentQueue: string[]): HandleQueueResult {
  const msgMatch = msg.match(/^\/msg\s+(.+)/)
  if (msgMatch) {
    return { note: msgMatch[1]!, queued: null }
  }
  return { note: null, queued: enqueue(currentQueue, msg) }
}
