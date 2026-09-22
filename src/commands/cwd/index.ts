import type { Command } from '../types.js'

/** `/cwd [path]` (alias `/cd`): shows the working directory, or changes it when a path is given. */
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
