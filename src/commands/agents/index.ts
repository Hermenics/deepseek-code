import type { Command } from '../types.js'

/** `/agents`: lists the custom agents available to load. */
const command: Command = {
  name: 'agents',
  aliases: [],
  description: 'List available agents',
  parse() {
    return { type: 'agents' }
  },
}

export default command
