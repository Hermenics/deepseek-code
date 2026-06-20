import type { Command } from '../types.js'

const command: Command = {
  name: 'language',
  aliases: [],
  description: 'Change preferred language',
  parse() {
    return { type: 'language' }
  },
}

export default command
