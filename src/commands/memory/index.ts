import type { Command } from '../types.js'

/** `/memory [clear [agent|user]]` (alias `/mem`): shows persistent memory, or clears it (optionally only one scope). */
const command: Command = {
  name: 'memory',
  aliases: ['mem'],
  description: 'View, search, inspect capacity, or clear persistent memory',
  parse(args) {
    if (args[0] === 'search') return { type: 'memory' as any, action: 'search', query: args.slice(1).join(' ') }
    if (args[0] === 'status') return { type: 'memory' as any, action: 'status' }
    if (args[0] === 'clear') {
      const target = args[1] as 'agent' | 'user' | undefined
      return { type: 'memory' as any, action: 'clear', target }
    }
    return { type: 'memory' as any, action: 'show' }
  },
}

export default command
