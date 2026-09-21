import { formatDuration } from './duration'

export function statusLine(task: string, startedAt: number, now = Date.now()): string {
  return `${task} · running for ${formatDuration(now - startedAt)}`
}
