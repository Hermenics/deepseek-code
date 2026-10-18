import { runGitInspection } from './gitInspection.js'

/** Managed worktrees use explicit application hooks, never Git checkout hooks or inherited repository overrides. */
export function runWorktreeGit(args: string[], cwd: string, options: { reject?: boolean; cancelSignal?: AbortSignal } = {}) {
  return runGitInspection(args, cwd, { timeout: 30_000, stripFinalNewline: false, disableHooks: true, ...options })
}
