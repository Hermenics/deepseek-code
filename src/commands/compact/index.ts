import type { Command } from '../types.js'

/** `/compact`: summarises the conversation history to free context window space. */
const command: Command = {
  name: 'compact',
  aliases: [],
  description: 'Summarize history to save context',
  parse() {
    return { type: 'compact' }
  },
}

export default command
