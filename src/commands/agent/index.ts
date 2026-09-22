import type { Command } from '../types.js'

/** `/agent <name>`: switches the session to a named custom agent. */
const command: Command = {
  name: 'agent',
  aliases: [],
  description: 'Load a custom agent',
  parse(args) {
    const name = args[0]
    if (name) return { type: 'agent', name }
    return { type: 'unknown', input: 'Usage: /agent <name>' }
  },
}

export default command
