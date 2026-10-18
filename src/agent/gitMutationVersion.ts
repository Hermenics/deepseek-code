import { createHash } from 'node:crypto'
import { captureWorkspaceVersion } from './workspaceVersion.js'
import { runGitInspection } from '../utils/gitInspection.js'

/** Read-only Git actions do not require a mutation approval identity. */
export function isGitMutation(toolName: string, args: Record<string, unknown>): boolean {
  return toolName === 'git' && !(['status', 'diff', 'log', 'batch'].includes(String(args.action)) || args.action === 'branch' && !args.create && !args.switch)
}

async function mutationState(cwd: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const results = await Promise.all([
      runGitInspection(['ls-files', '--stage', '-z'], cwd, { reject: false, cancelSignal: signal, maxBuffer: 4 * 1024 * 1024 }),
      runGitInspection(['config', '--null', '--list', '--includes'], cwd, { reject: false, cancelSignal: signal, maxBuffer: 4 * 1024 * 1024 }),
    ])
    if (results.some(result => result.failed || result.exitCode !== 0 || typeof result.stdout !== 'string')) throw new Error('Unavailable Git state')
    return results.map(result => createHash('sha256').update(result.stdout).digest('hex'))
  } catch {
    signal?.throwIfAborted()
    // Git configuration may contain credentials; never forward subprocess output or exception details.
    throw new Error('Cannot capture Git index/configuration identity; no mutation was authorized')
  }
}

/** Bind Git consent to staged blobs/modes/paths and effective configuration as well as source/checkout identity. */
export async function captureGitMutationVersion(cwd: string, signal?: AbortSignal): Promise<{ root: string; digest: string }> {
  const before = await mutationState(cwd, signal)
  const workspace = await captureWorkspaceVersion(cwd, signal)
  const after = await mutationState(workspace.cwd, signal)
  if (before.some((value, index) => value !== after[index])) throw new Error('Git index/configuration changed while capturing authorization identity; retry against current state')
  return { root: workspace.root, digest: createHash('sha256').update(JSON.stringify([workspace.digest, ...after])).digest('hex') }
}
