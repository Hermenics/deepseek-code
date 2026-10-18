import type { Command } from '../types.js'

/** `/steer <instruction>`: interrupts the active turn and prioritizes a generic task correction. */
const command: Command = {
  name: 'steer',
  aliases: [],
  description: 'Interrupt the current turn and prioritize a task correction',
  parse(args) {
    return { type: 'steer', instruction: args.join(' ') }
  },
}

export default command
