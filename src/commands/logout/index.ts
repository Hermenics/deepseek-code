import type { Command } from '../types.js'

const logout: Command = {
  name: 'logout',
  aliases: [],
  description: 'Clear all stored credentials and API keys',
  parse() {
    return { type: 'logout' }
  },
}

export default logout
