import type { Command } from '../types.js'

/** `/context` (alias `/ctx`): shows an estimated breakdown of context window usage. */
const command: Command = {
  name: 'context',
  aliases: ['ctx'],
  description: 'Show context window usage breakdown (estimated)',
  parse() {
    return { type: 'context' }
  },
}

export default command
