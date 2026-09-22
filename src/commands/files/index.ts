import type { Command } from '../types.js'

/** `/files`: lists the files modified during this session. */
const command: Command = {
  name: 'files',
  aliases: [],
  description: 'List modified files this session',
  parse() {
    return { type: 'files' }
  },
}

export default command
