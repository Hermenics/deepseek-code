import type { Command } from '../types.js'

const command: Command = {
  name: 'agents',
  aliases: [],
  description: 'List available agents',
  parse() {
    return { type: 'agents' }
  },
}

export default command
