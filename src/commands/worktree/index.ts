import type { Command } from '../types.js'

const command: Command = {
  name: 'worktree',
  aliases: ['wt'],
  description: 'Create or manage an isolated project copy',
  parse(args: string[]) {
    const action = args[0]
    if (!action) {
      return { type: 'worktree', action: 'create' }
    }
    if (action === 'exit' || action === 'leave') {
      const keep = args[1] === 'keep'
      return { type: 'worktree', action: 'exit', keep }
    }
    if (action === 'enter') {
      const name = args[1] ?? ''
      return { type: 'worktree', action: 'enter', name }
    }
    if (action === 'list' || action === 'ls') {
      return { type: 'worktree', action: 'list' }
    }
    if (action === 'status') {
      return { type: 'worktree', action: 'status' }
    }
    if (action === 'create') {
      return { type: 'worktree', action: 'create' }
    }
    return { type: 'unknown', input: `Unknown worktree action: ${action}. Use: create, enter, exit, list, status` }
  },
}

export default command
