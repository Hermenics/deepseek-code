import type { Command } from '../types.js'

/** `/btw <question>`: asks a side question without interrupting the running agent turn. */
const command: Command = {
  name: 'btw',
  aliases: [],
  description: 'Ask a quick side question without interrupting the agent',
  parse(args) {
    return { type: 'btw', question: args.join(' ') }
  },
}

export default command
