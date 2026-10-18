import type { Command } from '../types.js'

/** `/revise <objective>`: durably changes an unfinished goal objective. */
const command: Command = {
  name: 'revise',
  aliases: [],
  description: 'Revise an unfinished persistent goal',
  parse(args) {
    return { type: 'revise', objective: args.join(' ') }
  },
}

export default command
