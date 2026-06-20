import type { Command } from '../types.js'

const command: Command = {
  name: 'theme',
  aliases: [],
  description: 'Change color theme',
  parse() {
    return { type: 'theme' }
  },
}

export default command
