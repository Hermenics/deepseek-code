import type { Command } from '../types.js'

const command: Command = {
  name: 'cwd',
  aliases: ['cd'],
  description: 'Show or change working directory',
  parse(args: string[]) {
    const path = args.join(' ').trim() || undefined
    return { type: 'cwd', path }
  },
}

export default command
