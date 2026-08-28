import type { Command } from '../types.js'

const command: Command = {
  name: 'add-dir',
  aliases: [],
  description: 'Approve an additional directory for this session',
  parse(args) {
    if (args.length === 0) return { type: 'add-dir', action: 'list' }
    const action = args[0] === 'remove' ? 'remove' : 'add'
    const path = (action === 'remove' ? args.slice(1) : args).join(' ').trim()
    return path
      ? { type: 'add-dir', action, path }
      : { type: 'unknown', input: 'Usage: /add-dir [remove] <path>' }
  },
}

export default command
