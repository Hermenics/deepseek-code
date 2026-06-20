import type { Command } from '../types.js'

const command: Command = {
  name: 'msg',
  aliases: ['btw'],
  description: 'Add a note without interrupting the agent',
  parse(args) {
    const note = args.join(' ')
    if (!note) return { type: 'unknown', input: 'Usage: /msg <note> — add a note without interrupting the agent' }
    return { type: 'msg', note }
  },
}

export default command
