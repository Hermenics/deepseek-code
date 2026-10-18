import type { Command } from '../types.js'

const ACTIONS = new Set(['status', 'cancel', 'resume', 'result', 'message', 'integrate', 'cleanup', 'reconcile'])

/** `/task <id> [action]`: inspects or controls one task; reconciliation is explicit user evidence, not an automatic retry. */
const command: Command = {
  name: 'task',
  aliases: [],
  description: 'Inspect or control a task',
  parse(args) {
    const [id, rawAction = 'status', ...rest] = args
    if (!id) return { type: 'unknown', input: 'Usage: /task <id> status|cancel|resume|result|message|integrate|cleanup|reconcile <resolution> <evidence>' }
    if (!ACTIONS.has(rawAction)) return { type: 'unknown', input: `Unknown task action: ${rawAction}` }
    if (rawAction === 'message') {
      const message = rest.join(' ').trim()
      if (!message) return { type: 'unknown', input: 'Usage: /task <id> message <text>' }
      return { type: 'task', id, action: 'message', message }
    }
    if (rawAction === 'reconcile') {
      const [resolution, ...evidence] = rest
      if (!['no-effect', 'effect-observed', 'compensated'].includes(resolution ?? '') || !evidence.join(' ').trim()) {
        return { type: 'unknown', input: 'Usage: /task <id> reconcile no-effect|effect-observed|compensated <evidence>' }
      }
      return { type: 'task', id, action: 'reconcile', resolution: resolution as 'no-effect' | 'effect-observed' | 'compensated', evidence: evidence.join(' ').trim() }
    }
    return { type: 'task', id, action: rawAction as 'status' | 'cancel' | 'resume' | 'result' | 'integrate' | 'cleanup' }
  },
}

export default command
