export interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease: Array<string | number>
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parses a semver string; throws for an invalid one. */
export function parse(text: string): SemVer {
  const match = VERSION.exec(text.trim())
  if (!match) throw new Error(`invalid version: ${text}`)
  const prerelease = match[4] ? match[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : []
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease }
}

/** Semver 2.0.0 precedence: -1, 0 or 1. */
export function compare(a: SemVer, b: SemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

const COMPARATOR = /^(<=|>=|<|>|=)?(.+)$/

/** Whether the version satisfies one comparator such as `>=1.2.3`. */
function test(version: SemVer, comparator: string): boolean {
  const [, op = '=', rest] = COMPARATOR.exec(comparator)!
  const order = compare(version, parse(rest!))
  switch (op) {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
    default: return order === 0
  }
}

/** Whether the version satisfies the range. */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version)
  return range.trim().split(/\s+/).every((comparator) => test(v, comparator))
}
