import type { InlineGhostText } from './types.js'

const ARGUMENT_HINTS: Record<string, string> = {
  '/agent': '<name>',
  '/model': '<model-name>',
  '/plan': '<task description>',
  '/review': '<file or description>',
  '/msg': '<note>',
  '/language': '<language>',
  '/theme': '<theme>',
  '/checkpoint': '<name>',
  '/sessions': '',
  '/files': '',
}

export function getArgumentHint(value: string): InlineGhostText | null {
  const trimmed = value.trimEnd()
  if (!trimmed.startsWith('/')) return null
  if (!value.endsWith(' ')) return null

  const hint = ARGUMENT_HINTS[trimmed]
  if (!hint) return null

  return {
    text: hint,
    fullCommand: value,
    insertPosition: value.length,
  }
}
