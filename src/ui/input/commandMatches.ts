import Fuse from 'fuse.js'
import { COMMAND_SUGGESTIONS } from '../../commands.js'
import { getWorkflowCommandSuggestions } from '../../workflows/commands.js'

let fuseInstance: Fuse<string> | null = null
let fuseKey = ''

export function getCommandSuggestions(): string[] {
  return [...new Set([...COMMAND_SUGGESTIONS, ...getWorkflowCommandSuggestions()])]
}

function getFuse(): Fuse<string> {
  const suggestions = getCommandSuggestions()
  const key = suggestions.join('\0')
  if (!fuseInstance || key !== fuseKey) {
    fuseKey = key
    fuseInstance = new Fuse(suggestions, {
      threshold: 0.4,
      distance: 100,
      includeScore: true,
      minMatchCharLength: 2,
    })
  }

  return fuseInstance
}

export function getMatches(value: string): string[] {
  const suggestions = getCommandSuggestions()
  if (!value.startsWith('/')) return []
  if (/\s/.test(value)) return []
  if (value === '/') return suggestions
  if (value.length < 2) return []

  const prefixMatches = suggestions.filter((s) => s.startsWith(value))
  if (prefixMatches.length > 0) return prefixMatches

  const query = value.slice(1)
  const results = getFuse().search(query)
  return results.slice(0, 8).map((r) => r.item)
}
