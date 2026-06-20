import type { Command } from '../types.js'

const command: Command = {
  name: 'retry',
  aliases: [],
  description: 'Re-run last message',
  parse() {
    return { type: 'retry' }
  },
}

export default command
