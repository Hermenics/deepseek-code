import type { Command } from '../types.js'

const command: Command = {
  name: 'clear',
  aliases: [],
  description: 'Clear chat history',
  parse() {
    return { type: 'clear' }
  },
}

export default command
