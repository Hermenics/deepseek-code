import type { Command } from '../types.js'

const command: Command = {
  name: 'system',
  aliases: [],
  description: 'Show active system prompt',
  parse() {
    return { type: 'system' }
  },
}

export default command
