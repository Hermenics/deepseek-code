import type { Command } from '../types.js'

/** `/plan <task>`: explores read-only and proposes an implementation plan for approval before any edits. */
const command: Command = {
  name: 'plan',
  aliases: [],
  description: 'Plan implementation of a task (read-only exploration + approval dialog)',
  parse(args: string[]) {
    const task = args.join(' ').trim()
    if (!task) return { type: 'unknown' as const, input: 'Usage: /plan <task description>' }
    return { type: 'plan' as const, task }
  },
}
export default command
