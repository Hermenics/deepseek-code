import type { Command } from '../types.js'

const ACTIONS = new Set(['status', 'cancel', 'resume', 'result', 'message', 'integrate', 'cleanup'])

const command: Command = {
  name: 'task',
  aliases: [],
  description: 'Inspect or control a task',
  parse(args) {
    const [id, rawAction = 'status', ...rest] = args
    if (!id) return { type: 'unknown', input: 'Usage: /task <id> status|cancel|resume|result|message|integrate|cleanup' }
    if (!ACTIONS.has(rawAction)) return { type: 'unknown', input: `Unknown task action: ${rawAction}` }
    if (rawAction === 'message') {
      const message = rest.join(' ').trim()
      if (!message) return { type: 'unknown', input: 'Usage: /task <id> message <text>' }
      return { type: 'task', id, action: 'message', message }
    }
    return { type: 'task', id, action: rawAction as 'status' | 'cancel' | 'resume' | 'result' | 'integrate' | 'cleanup' }
  },
}

export default command
