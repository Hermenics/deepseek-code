import type { Command, CommandResult } from '../types.js'
import { listSessions } from '../../agent/session.js'
import { resolve } from 'node:path'

const sessionIdCache = new Map<string, { expiresAt: number; ids: Promise<string[]> }>()

function listLocalSessionIds(cwd: string): Promise<string[]> {
  const key = resolve(cwd)
  const cached = sessionIdCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.ids
  const ids = listSessions(cwd)
    .then(sessions => sessions.map(session => session.id).filter(id => /^[a-f0-9]{12}$/i.test(id)))
  sessionIdCache.set(key, { expiresAt: Date.now() + 1_000, ids })
  return ids
}

/** Parses `/sessions [export <12-hex-id> [json|md]]`; exports default to Markdown. */
export function parseSessionsCommand(args: string[]): CommandResult {
  if (args[0] !== 'export') return { type: 'sessions' }
  const id = args[1]
  if (!id || !/^[a-f0-9]{12}$/i.test(id)) return { type: 'unknown', input: 'Usage: /sessions export <12-character-id> [json|md]' }
  const format = args[2] ?? 'md'
  if (format !== 'json' && format !== 'md') return { type: 'unknown', input: 'Format must be json or md.' }
  return { type: 'sessions', action: 'export', id, format }
}

/** `/sessions`: lists saved sessions or exports one in sanitized JSON/Markdown. */
const command: Command = {
  name: 'sessions',
  aliases: [],
  description: 'List or export sanitized sessions',
  async complete(args, context) {
    if (args.length === 0) return ['export']
    if (args[0] !== 'export') return []
    if (args.length === 1) return listLocalSessionIds(context.cwd)
    if (args.length === 2) return ['json', 'md']
    return []
  },
  parse(args) {
    return parseSessionsCommand(args)
  },
}

export default command
