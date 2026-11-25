import type { Command } from '../types.js'
import { listWorktrees } from '../../agent/worktree.js'
import { resolve } from 'node:path'

const worktreeNameCache = new Map<string, { expiresAt: number; names: Promise<string[]> }>()

function listLocalWorktreeNames(cwd: string): Promise<string[]> {
  const key = resolve(cwd)
  const cached = worktreeNameCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.names
  const names = listWorktrees(cwd).then(worktrees => worktrees.map(worktree => worktree.name))
  worktreeNameCache.set(key, { expiresAt: Date.now() + 1_000, names })
  return names
}

/** `/worktree` (alias `/wt`): creates (default), enters, exits, lists or reports status of isolated worktree copies of the project; `exit keep` preserves the copy. */
const command: Command = {
  name: 'worktree',
  aliases: ['wt'],
  description: 'Create or manage an isolated project copy',
  async complete(args, context) {
    if (args.length === 0) return ['create', 'enter', 'exit', 'list', 'status']
    if (args.length === 1 && args[0] === 'enter') return listLocalWorktreeNames(context.cwd)
    if (args.length === 1 && (args[0] === 'exit' || args[0] === 'leave')) return ['keep']
    return []
  },
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
