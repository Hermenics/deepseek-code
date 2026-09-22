import type { InlineGhostText } from './types.js'

const ARGUMENT_HINTS: Record<string, string> = {
  '/agent': '<name>',
  '/model': '<model-name>',
  '/plan': '<task description>',
  '/review': '<file or description>',
  '/btw': '<question>',
  '/language': '<language>',
  '/theme': '<theme>',
  '/checkpoint': '<name>',
  '/effort': '[low/high/max]',
  '/sessions': '',
  '/files': '',
  '/goal': '[<condition> | clear]',
}

/** Argument placeholder for a known slash command once it is typed exactly (optionally followed by spaces); null otherwise. */
export function getArgumentHint(value: string): InlineGhostText | null {
  const trimmed = value.trimEnd()
  if (!trimmed.startsWith('/')) return null
  if (value !== trimmed && !value.endsWith(' ')) return null

  const hint = ARGUMENT_HINTS[trimmed]
  if (!hint) return null

  return {
    text: hint,
    fullCommand: value,
    insertPosition: value.length,
  }
}
