import type { InlineGhostText } from './types.js'

export function getHistoryGhost(value: string, history: string[]): InlineGhostText | null {
  if (value.length < 2) return null

  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i]!
    if (entry.startsWith(value) && entry !== value && entry.length > value.length) {
      return {
        text: entry.slice(value.length),
        fullCommand: entry,
        insertPosition: value.length,
      }
    }
  }

  return null
}
