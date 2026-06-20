import type { InlineGhostText } from './types.js'

export function getCommandGhost(value: string, commands: string[]): InlineGhostText | null {
  if (!value.startsWith('/') || value.length < 2) return null
  const match = commands.find((cmd) => cmd.startsWith(value) && cmd !== value)
  if (!match) return null

  return {
    text: match.slice(value.length),
    fullCommand: match,
    insertPosition: value.length,
  }
}
