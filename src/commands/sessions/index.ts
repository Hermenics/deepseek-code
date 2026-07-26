import type { Command, CommandResult } from '../types.js'

export function parseSessionsCommand(args: string[]): CommandResult {
  if (args[0] !== 'export') return { type: 'sessions' }
  const id = args[1]
  if (!id || !/^[a-f0-9]{12}$/i.test(id)) return { type: 'unknown', input: 'Usage: /sessions export <12-character-id> [json|md]' }
  const format = args[2] ?? 'md'
  if (format !== 'json' && format !== 'md') return { type: 'unknown', input: 'Format must be json or md.' }
  return { type: 'sessions', action: 'export', id, format }
}

const command: Command = {
  name: 'sessions',
  aliases: [],
  description: 'List or export sanitized sessions',
  parse(args) {
    return parseSessionsCommand(args)
  },
}

export default command
