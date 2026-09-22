import type { Command } from '../types.js'

/** `/tools`: lists the tools available to the agent. */
const command: Command = {
  name: 'tools',
  aliases: [],
  description: 'List available tools',
  parse() {
    return { type: 'tools' }
  },
}

export default command
