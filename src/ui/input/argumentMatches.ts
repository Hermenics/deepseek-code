import { getCommandArgumentSuggestions } from '../../commands.js'

export interface ArgumentMatches {
  values: string[]
  replaceStart: number
  replaceEnd: number
}

/** Finds local candidates for the current argument of an exact built-in slash command. */
export function getArgumentMatches(value: string, cursorOffset: number, cwd: string): ArgumentMatches | Promise<ArgumentMatches | null> | null {
  if (!value.startsWith('/') || cursorOffset !== value.length || value.includes('\n')) return null
  const commandEnd = value.search(/\s/)
  if (commandEnd < 2 || cursorOffset <= commandEnd) return null

  const commandName = value.slice(1, commandEnd)
  const argumentText = value.slice(commandEnd + 1, cursorOffset)
  const hasTrailingSpace = /\s$/.test(argumentText)
  const tokens = argumentText.trim().split(/\s+/).filter(Boolean)
  const prefix = hasTrailingSpace ? '' : tokens.pop() ?? ''
  const priorArgs = tokens
  const candidates = getCommandArgumentSuggestions(commandName, priorArgs, { cwd })
  const buildMatches = (values: string[]): ArgumentMatches | null => {
    const filtered = values.filter(candidate =>
      candidate.length <= 160 &&
      !/[\\/\s\u0000-\u001f]/.test(candidate) &&
      candidate !== '.' && candidate !== '..' && !candidate.startsWith('.') &&
      candidate.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))

    if (filtered.length === 0) return null
    return { values: filtered, replaceStart: cursorOffset - prefix.length, replaceEnd: cursorOffset }
  }
  return Array.isArray(candidates) ? buildMatches(candidates) : candidates.then(buildMatches)
}
