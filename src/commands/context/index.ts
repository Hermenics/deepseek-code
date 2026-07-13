import type { Command } from '../types.js'

const command: Command = {
  name: 'context',
  aliases: ['ctx'],
  description: 'Show context window usage breakdown (estimated)',
  parse() {
    return { type: 'context' }
  },
}

export default command
