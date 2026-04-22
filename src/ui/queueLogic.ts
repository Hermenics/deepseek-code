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
