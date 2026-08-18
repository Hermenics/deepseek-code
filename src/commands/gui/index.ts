import type { Command } from '../types.js'

const command: Command = {
  name: 'gui',
  aliases: [],
  description: 'Open the local browser workspace',
  parse() {
    return { type: 'gui' }
  },
}

export default command
