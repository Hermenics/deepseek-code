const UNITS: Array<[unit: string, ms: number]> = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
]

/**
 * Formats a duration for status lines: whole milliseconds under a second, otherwise the two
 * largest non-zero units, e.g. 5_400_000 → "1h 30m" and 90_500 → "1m 30s". Negative input counts as 0.
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`
  let rest = Math.floor(ms / 1_000) * 1_000
  const parts: string[] = []
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size)
    if (count > 0) {
      parts.push(`${count}${unit}`)
      rest -= count * size
    }
    if (parts.length === 2) break
  }
  return parts.join(' ')
}
