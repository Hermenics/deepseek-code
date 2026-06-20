import type { Command } from '../types.js'

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
