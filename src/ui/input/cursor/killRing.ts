const KILL_RING_MAX_SIZE = 10

let killRing: string[] = []
let killRingIndex = 0
let lastActionWasKill = false

let lastYankStart = 0
let lastYankLength = 0
let lastActionWasYank = false

/** Adds killed text to the module-global kill ring (max 10 entries). Consecutive kills merge into the newest entry, prepended for backward kills and appended for forward ones, as in Emacs. */
export function pushToKillRing(
  text: string,
  direction: 'prepend' | 'append' = 'append',
): void {
  if (text.length === 0) return

  if (lastActionWasKill && killRing.length > 0) {
    killRing[0] =
      direction === 'prepend' ? text + killRing[0] : killRing[0] + text
  } else {
    killRing.unshift(text)
    if (killRing.length > KILL_RING_MAX_SIZE) {
      killRing.pop()
    }
  }

  lastActionWasKill = true
  lastActionWasYank = false
}

export function getLastKill(): string {
  return killRing[0] ?? ''
}

/** Ends the current kill run so the next kill starts a new ring entry instead of merging. */
export function resetKillAccumulation(): void {
  lastActionWasKill = false
}

/** After a yank, cycles to the next older kill ring entry and returns it with the span of the previous yank to replace; null if the last action was not a yank or there is nothing to cycle. */
export function yankPop(): { text: string; start: number; length: number } | null {
  if (!lastActionWasYank || killRing.length <= 1) return null

  killRingIndex = (killRingIndex + 1) % killRing.length
  return {
    text: killRing[killRingIndex] ?? '',
    start: lastYankStart,
    length: lastYankLength,
  }
}

/** Records the span of a just-inserted yank so yankPop can replace it, restarting the cycle from the newest entry. */
export function recordYank(start: number, length: number): void {
  lastYankStart = start
  lastYankLength = length
  lastActionWasYank = true
  killRingIndex = 0
}

/** Ends yank-pop eligibility, e.g. after any non-yank edit. */
export function resetYankState(): void {
  lastActionWasYank = false
}

/** Empties the kill ring and resets all kill/yank tracking. */
export function clearKillRing(): void {
  killRing = []
  killRingIndex = 0
  lastActionWasKill = false
  lastActionWasYank = false
  lastYankStart = 0
  lastYankLength = 0
}
