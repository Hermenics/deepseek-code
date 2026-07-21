import type { Command } from '../types.js'

const command: Command = {
  name: 'btw',
  aliases: [],
  description: 'Ask a quick side question without interrupting the agent',
  parse(args) {
    return { type: 'btw', question: args.join(' ') }
  },
}

export default command
