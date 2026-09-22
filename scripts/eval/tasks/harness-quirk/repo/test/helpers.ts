const UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1_000,
  h: 60 * 60 * 1_000,
  m: 60 * 60 * 1_000,
  s: 1_000,
}

/** Test shorthand: ms('1h 30m') is the number of milliseconds in one hour and thirty minutes. */
export function ms(text: string): number {
  return text.trim().split(/\s+/).reduce((total, part) => {
    const match = /^(\d+)([dhms])$/.exec(part)
    if (!match) throw new Error(`bad duration part: ${part}`)
    return total + Number(match[1]) * UNIT_MS[match[2]!]!
  }, 0)
}
