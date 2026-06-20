import type { Command } from '../types.js'

const command: Command = {
  name: 'files',
  aliases: [],
  description: 'List modified files this session',
  parse() {
    return { type: 'files' }
  },
}

export default command
