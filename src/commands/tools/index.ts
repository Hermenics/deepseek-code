import type { Command } from '../types.js'

const command: Command = {
  name: 'tools',
  aliases: [],
  description: 'List available tools',
  parse() {
    return { type: 'tools' }
  },
}

export default command
