/**
 * Ghost-cursor key filter logic.
 *
 * Filters out spurious key events that arrive from terminal mouse/scroll/focus
 * events that the terminal parser doesn't fully handle.
 */

export interface FilterKeyEvent {
  name?: string
  raw?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

/**
 * Returns true if the key event should be DISCARDED (filtered out).
 */
export function shouldFilterKey(key: FilterKeyEvent): boolean {
  // Filter 1: mouse scroll — up/down with raw longer than 3 bytes
  if ((key.name === 'up' || key.name === 'down') && key.raw && key.raw.length > 3) {
    return true
  }

  // Filter 2: unrecognized ANSI escape sequences (name === undefined)
  if (!key.name && key.raw) {
    if (key.raw.startsWith('\x1b')) return true
    if (key.raw.length === 1 && key.raw.charCodeAt(0) < 32) return true
  }

  // Filter 3: spurious single uppercase ANSI suffix chars
  if (key.name && key.raw && key.raw.length === 1 && !key.ctrl && !key.meta && !key.shift) {
    if (/^[A-Z]$/.test(key.raw) && ['A', 'B', 'C', 'D', 'H', 'F', 'W', 'M'].includes(key.raw)) {
      return true
    }
  }

  return false
}
