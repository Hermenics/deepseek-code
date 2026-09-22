import type { Command } from '../types.js'

/** `/clear`: wipes the chat history. */
const command: Command = {
  name: 'clear',
  aliases: [],
  description: 'Clear chat history',
  parse() {
    return { type: 'clear' }
  },
}

export default command
