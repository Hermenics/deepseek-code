import { COMMAND_SUGGESTIONS } from '../../commands.js'

export function getMatches(value: string): string[] {
  if (!value.startsWith('/')) return []
  return COMMAND_SUGGESTIONS.filter((s) => s.startsWith(value))
}
