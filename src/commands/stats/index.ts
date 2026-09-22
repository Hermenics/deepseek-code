import type { Command } from '../types.js'

/** `/stats`: shows session statistics. */
const command: Command = {
  name: 'stats',
  aliases: [],
  description: 'Show session statistics',
  parse() {
    return { type: 'stats' }
  },
}

export default command
