const KILL_RING_MAX_SIZE = 10

let killRing: string[] = []
let killRingIndex = 0
let lastActionWasKill = false

let lastYankStart = 0
let lastYankLength = 0
let lastActionWasYank = false

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

export function resetKillAccumulation(): void {
  lastActionWasKill = false
}

export function yankPop(): { text: string; start: number; length: number } | null {
  if (!lastActionWasYank || killRing.length <= 1) return null

  killRingIndex = (killRingIndex + 1) % killRing.length
  return {
    text: killRing[killRingIndex] ?? '',
    start: lastYankStart,
    length: lastYankLength,
  }
}

export function recordYank(start: number, length: number): void {
  lastYankStart = start
  lastYankLength = length
  lastActionWasYank = true
  killRingIndex = 0
}

export function resetYankState(): void {
  lastActionWasYank = false
}

export function clearKillRing(): void {
  killRing = []
  killRingIndex = 0
  lastActionWasKill = false
  lastActionWasYank = false
  lastYankStart = 0
  lastYankLength = 0
}
