import Fuse from 'fuse.js'
import { COMMAND_SUGGESTIONS } from '../../commands.js'
import { getWorkflowCommandSuggestions } from '../../workflows/commands.js'
import { getCustomCommandSuggestions } from '../../commands/custom.js'

let fuseInstance: Fuse<string> | null = null
let fuseKey = ''

/** All slash commands available for completion (built-in, workflow and custom), de-duplicated. */
export function getCommandSuggestions(): string[] {
  return [...new Set([...COMMAND_SUGGESTIONS, ...getWorkflowCommandSuggestions(), ...getCustomCommandSuggestions()])]
}

/** Returns a cached Fuse index over the command list, rebuilt only when the set of commands changes (e.g. custom commands were added). */
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

/** Slash-command completions for the input: every command for a bare '/', prefix matches when any exist, otherwise up to 8 fuzzy matches. Empty once the input contains whitespace, i.e. arguments have started. */
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
