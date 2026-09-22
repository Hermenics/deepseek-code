import type { Command } from '../types.js'

/** `/branch [title]`: forks the conversation into a new derived session, leaving the current one untouched. */
const command: Command = {
  name: 'branch', aliases: [], description: 'Create a derived session and keep this session intact',
  parse(args) {
    const title = args.join(' ').trim()
    return title ? { type: 'branch', title } : { type: 'branch' }
  },
}

export default command
