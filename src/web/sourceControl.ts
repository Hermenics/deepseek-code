import { isAbsolute, relative, resolve } from 'node:path'
import { execa } from 'execa'
import type { SourceControlFile, SourceControlSnapshot } from './protocol.js'
import { isWindows } from '../utils/platform.js'

const MAX_DIFF_CHARS = 300_000

function isInsideWorkspace(workspace: string, file: string): boolean {
  const path = relative(workspace, resolve(workspace, file))
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa('git', args, { cwd, reject: false })
  return { stdout: [result.stdout, result.stderr].filter(Boolean).join('\n'), exitCode: result.exitCode ?? 1 }
}

function parseBranch(header: string): Pick<SourceControlSnapshot, 'branch' | 'upstream' | 'ahead' | 'behind'> {
  // ## main...origin/main [ahead 2, behind 1]
  const raw = header.slice(3)
  const [branchPart, tracking = ''] = raw.split(' [', 2)
  const [branch = null, upstream = null] = branchPart!.split('...', 2)
  const ahead = /ahead (\d+)/.exec(tracking)?.[1]
  const behind = /behind (\d+)/.exec(tracking)?.[1]
  return { branch: branch === 'HEAD (no branch)' ? null : branch, upstream, ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) }
}

function parseStatus(output: string): Omit<SourceControlSnapshot, 'repository' | 'selectedPath' | 'diff' | 'stagedDiff'> {
  const entries = output.split('\0').filter(Boolean)
  const header = entries[0]?.startsWith('## ') ? entries.shift()! : ''
  const files: SourceControlFile[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    if (entry.length < 4) continue
    const indexStatus = entry[0]!
    const worktreeStatus = entry[1]!
    const path = entry.slice(3)
    let previousPath: string | undefined
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') previousPath = entries[++index]
    files.push({ path, previousPath, indexStatus, worktreeStatus })
  }
  return { ...parseBranch(header), files }
}

function truncateDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n… Diff truncated at ${MAX_DIFF_CHARS.toLocaleString()} characters.` : diff
}

async function fileDiff(cwd: string, path: string, staged: boolean): Promise<string> {
  const args = ['diff', '--no-ext-diff', '--unified=3']
  if (staged) args.push('--cached')
  args.push('--', path)
  const result = await git(cwd, args)
  if (result.stdout || staged) return result.stdout
  // Git does not include untracked files in `git diff`; render those as new files.
  const untracked = await git(cwd, ['diff', '--no-index', '--unified=3', '--', isWindows ? 'NUL' : '/dev/null', path])
  return untracked.exitCode === 1 ? untracked.stdout : ''
}

/** Read the exact Source Control state exposed by the GUI — never shell out on client input. */
export async function getSourceControl(cwd: string, selectedPath?: string): Promise<SourceControlSnapshot> {
  const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '--branch', '-z'])
  if (status.exitCode !== 0) {
    return { repository: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [], diff: '', stagedDiff: '' }
  }
  const snapshot = parseStatus(status.stdout)
  const path = selectedPath && snapshot.files.some((file) => file.path === selectedPath) ? selectedPath : snapshot.files[0]?.path
  if (!path) return { repository: true, ...snapshot, diff: '', stagedDiff: '' }
  const [diff, stagedDiff] = await Promise.all([fileDiff(cwd, path, false), fileDiff(cwd, path, true)])
  return { repository: true, ...snapshot, selectedPath: path, diff: truncateDiff(diff), stagedDiff: truncateDiff(stagedDiff) }
}

/** Stage or unstage only paths that resolve beneath the served workspace. */
export async function changeStaging(cwd: string, action: 'stage' | 'unstage', paths: string[]): Promise<void> {
  const requested = paths.filter((path) => path && isInsideWorkspace(cwd, path))
  if (requested.length !== paths.length) throw new Error('A requested file is outside the workspace')
  let valid = requested
  if (action === 'unstage') {
    const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z'])
    if (status.exitCode !== 0) throw new Error(status.stdout || 'Could not read file status')
    const staged = parseStatus(status.stdout).files
      .filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?')
      .map((file) => file.path)
    valid = requested.filter((path) => staged.includes(path))
    if (!valid.length) return
  }
  const args = action === 'stage' ? ['add', '--', ...valid] : ['restore', '--staged', '--', ...valid]
  const result = await git(cwd, args)
  if (result.exitCode !== 0) throw new Error(result.stdout || `Could not ${action} files`)
}

/** Commit only the index; unstaged working-tree edits stay untouched. */
export async function commitStaged(cwd: string, message: string): Promise<string> {
  const normalized = message.trim()
  if (!normalized || normalized.length > 500) throw new Error('Commit message must be between 1 and 500 characters')
  const staged = await git(cwd, ['diff', '--cached', '--quiet'])
  if (staged.exitCode === 0) throw new Error('No staged changes to commit')
  const result = await git(cwd, ['commit', '-m', normalized])
  if (result.exitCode !== 0) throw new Error(result.stdout || 'Could not create commit')
  return result.stdout
}
