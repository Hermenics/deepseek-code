import type { Command } from '../types.js'

const command: Command = {
  name: 'sessions',
  aliases: [],
  description: 'List recent sessions',
  parse() {
    return { type: 'sessions' }
  },
}

export default command
