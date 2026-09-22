import type { Command } from '../types.js'

/** `/cost`: shows the estimated cost of the session so far. */
const command: Command = {
  name: 'cost',
  aliases: [],
  description: 'Show estimated session cost',
  parse() {
    return { type: 'cost' }
  },
}

export default command
