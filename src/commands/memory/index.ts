import type { Command } from '../types.js'

const command: Command = {
  name: 'memory',
  aliases: ['mem'],
  description: 'View or clear persistent memory',
  parse(args) {
    if (args[0] === 'clear') {
      const target = args[1] as 'agent' | 'user' | undefined
      return { type: 'memory' as any, action: 'clear', target }
    }
    return { type: 'memory' as any, action: 'show' }
  },
}

export default command
