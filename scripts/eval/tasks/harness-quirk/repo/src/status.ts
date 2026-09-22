import { formatDuration } from './duration'

/** Status line showing how long a task has been running. */
export function statusLine(task: string, startedAt: number, now = Date.now()): string {
  return `${task} · running for ${formatDuration(now - startedAt)}`
}
