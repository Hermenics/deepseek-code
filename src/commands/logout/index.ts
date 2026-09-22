import type { Command } from '../types.js'

/** `/logout`: clears all stored credentials and API keys. */
const logout: Command = {
  name: 'logout',
  aliases: [],
  description: 'Clear all stored credentials and API keys',
  parse() {
    return { type: 'logout' }
  },
}

export default logout
