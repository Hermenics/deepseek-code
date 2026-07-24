import Fuse from 'fuse.js'
import { COMMAND_SUGGESTIONS } from '../../commands.js'

let fuseInstance: Fuse<string> | null = null

function getFuse(): Fuse<string> {
  if (!fuseInstance) {
    fuseInstance = new Fuse(COMMAND_SUGGESTIONS, {
      threshold: 0.4,
      distance: 100,
      includeScore: true,
      minMatchCharLength: 2,
    })
  }

  return fuseInstance
}

export function getMatches(value: string): string[] {
  if (!value.startsWith('/')) return []
  if (/\s/.test(value)) return []
  if (value === '/') return COMMAND_SUGGESTIONS
  if (value.length < 2) return []

  const prefixMatches = COMMAND_SUGGESTIONS.filter((s) => s.startsWith(value))
  if (prefixMatches.length > 0) return prefixMatches

  const query = value.slice(1)
  const results = getFuse().search(query)
  return results.slice(0, 8).map((r) => r.item)
}
