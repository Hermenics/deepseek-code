import { createHash } from 'node:crypto'
import { lstat, readdir, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { runGitInspection } from '../utils/gitInspection.js'
import { hashFileContent, isSensitiveWorkspacePath } from '../tools/shared/pathSafety.js'
import { redactSecrets } from '../orchestration/events.js'

export interface WorkspaceVersion {
  cwd: string
  root: string
  head: string | null
  branch: string | null
  digest: string
  fileCount: number
  fileDigests?: ReadonlyMap<string, string>
}

export interface WorkspaceFileChange {
  path: string
  change: 'added' | 'modified' | 'removed'
}

export function diffWorkspaceFileDigests(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): { changes: WorkspaceFileChange[]; omitted: number } {
  const changes: WorkspaceFileChange[] = []
  let count = 0
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(path)
    const current = after.get(path)
    if (previous === current) continue
    count++
    if (changes.length < 100) changes.push({ path, change: previous === undefined ? 'added' : current === undefined ? 'removed' : 'modified' })
  }
  return { changes, omitted: count - changes.length }
}

const MAX_FILES = 10_000
// shortcut: manifests above 512 KiB keep aggregate-only status; move them to a sidecar if that limit matters.
const MAX_PERSISTED_FILE_DIGESTS_BYTES = 512 * 1024
const EXCLUDED = new Set(['.git', '.deepseek', '.deepseek-code', 'node_modules', 'dist', 'coverage', '__eval_check__'])
const HASH = /^[a-f0-9]{64}$/
interface GitResult { exitCode: number | null; stdout: string }

export function serializeWorkspaceFileDigests(fileDigests?: ReadonlyMap<string, string>): Array<[string, string]> | undefined {
  if (!fileDigests || fileDigests.size > MAX_FILES) return undefined
  const entries = [...fileDigests].sort(([a], [b]) => a.localeCompare(b))
  const serialized = JSON.stringify(entries)
  return Buffer.byteLength(serialized) <= MAX_PERSISTED_FILE_DIGESTS_BYTES && redactSecrets(serialized) === serialized ? entries : undefined
}

export function restoreWorkspaceFileDigests(value: unknown): Map<string, string> | undefined {
  if (!Array.isArray(value) || value.length > MAX_FILES
    || Buffer.byteLength(JSON.stringify(value)) > MAX_PERSISTED_FILE_DIGESTS_BYTES) return undefined
  const fileDigests = new Map<string, string>()
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string'
      || !entry[0] || entry[0].length > 1024 || entry[1].length > 8192
      || entry[0].startsWith('/') || entry[0].split('/').some(part => !part || part === '.' || part === '..')
      || fileDigests.has(entry[0])) return undefined
    fileDigests.set(entry[0], entry[1])
  }
  return fileDigests
}

async function runGit(args: string[], cwd: string, signal?: AbortSignal): Promise<GitResult | null> {
  try {
    const result = await runGitInspection(args, cwd, { reject: false, timeout: 3_000, cancelSignal: signal, maxBuffer: 4 * 1024 * 1024 })
    if (typeof result.stdout !== 'string') throw new Error('Git returned non-text output while fingerprinting')
    return { exitCode: result.exitCode ?? null, stdout: result.stdout }
  } catch (error) {
    signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function listGitFiles(root: string, signal?: AbortSignal): Promise<string[] | null> {
  const result = await runGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root, signal)
  if (!result || result.exitCode !== 0) return null
  return [...new Set(result.stdout.split('\0').filter(Boolean))]
}

async function listSourceFiles(root: string, gitFiles: string[] | null, signal?: AbortSignal): Promise<string[]> {
  if (gitFiles) return gitFiles
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted()
      if (EXCLUDED.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files.push(relative(root, path))
      if (files.length > MAX_FILES) throw new Error('Workspace fingerprint exceeds 10000 files; verification scope is unavailable')
    }
  }
  await visit(root)
  return files
}

function contained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function realpathWithMissingTail(path: string): Promise<string> {
  let current = resolve(path)
  const tail: string[] = []
  while (true) {
    try { return resolve(await realpath(current), ...tail) }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const parent = dirname(current)
      if (parent === current) throw error
      tail.unshift(basename(current))
      current = parent
    }
  }
}

async function workspaceExclusions(root: string, paths: readonly string[]): Promise<{ roots: string[]; identity: string[] }> {
  const roots = new Set<string>()
  const identity = new Set<string>()
  for (const path of paths) {
    const requested = resolve(path)
    const resolvedPath = await realpathWithMissingTail(requested)
    const requestedInside = contained(root, requested)
    const resolvedInside = contained(root, resolvedPath)
    if (requestedInside && !resolvedInside) throw new Error(`Workspace fingerprint exclusion escapes root: ${relative(root, requested)}`)
    if (!resolvedInside) continue

    const resolvedRelative = relative(root, resolvedPath).split(sep).join('/')
    if (!resolvedRelative) throw new Error('Workspace fingerprint cannot exclude its root')
    roots.add(resolvedRelative)
    const requestedRelative = requestedInside ? relative(root, requested).split(sep).join('/') : undefined
    if (requestedRelative) roots.add(requestedRelative)
    identity.add(`${requestedRelative ?? '<outside>'}\0${resolvedRelative}`)
  }
  return { roots: [...roots].sort(), identity: [...identity].sort() }
}

function isExcludedWorkspaceFile(file: string, roots: readonly string[]): boolean {
  const normalized = file.split(/[\\/]/).join('/')
  return roots.some(root => normalized === root || normalized.startsWith(`${root}/`))
}

async function assertSafeParentChain(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  if (!contained(root, target)) throw new Error(`Workspace fingerprint path escapes root: ${rel}`)
  let current = root
  const parts = rel.split(sep).filter(Boolean)
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Workspace fingerprint has an unsafe parent: ${relative(root, current)}`)
  }
  if (!contained(root, await realpath(join(target, '..')))) throw new Error(`Workspace fingerprint parent escapes root: ${rel}`)
}

function statIdentity(info: { dev: bigint; ino: bigint; mode: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string {
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

function sameFiles(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index])
}

/** Recheck the exact identities used by a fingerprint before returning its digest. */
export async function assertCapturedWorkspaceInputsUnchanged(
  root: string,
  identities: ReadonlyMap<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  for (const [file, identity] of identities) {
    signal?.throwIfAborted()
    const current = await lstat(resolve(root, file), { bigint: true }).catch(() => undefined)
    if (!current || statIdentity(current) !== identity) {
      throw new Error(`Workspace changed while fingerprinting: ${file}`)
    }
  }
}

async function gitIdentity(root: string, signal?: AbortSignal): Promise<{ head: string | null; branch: string | null }> {
  const [head, branch] = await Promise.all([
    runGit(['rev-parse', 'HEAD'], root, signal),
    runGit(['symbolic-ref', '--short', 'HEAD'], root, signal),
  ])
  return {
    head: head?.exitCode === 0 ? head.stdout.trim() : null,
    branch: branch?.exitCode === 0 ? branch.stdout.trim() : null,
  }
}

/** Resolve the repository root used to bound source and dependency fingerprints. */
export async function resolveWorkspaceRoot(cwd: string, signal?: AbortSignal): Promise<string> {
  const requestedRoot = await realpath(resolve(cwd))
  const topLevel = await runGit(['rev-parse', '--show-toplevel'], requestedRoot, signal)
  return topLevel?.exitCode === 0 ? realpath(topLevel.stdout.trim()) : requestedRoot
}

/** Fingerprint source/config inputs without following symlinks or reading credentials. */
export async function captureWorkspaceVersion(cwd: string, signal?: AbortSignal, excludedPaths: readonly string[] = [], options: { includeFileDigests?: boolean } = {}): Promise<WorkspaceVersion> {
  signal?.throwIfAborted()
  const requestedRoot = await realpath(resolve(cwd))
  const topLevel = await runGit(['rev-parse', '--show-toplevel'], requestedRoot, signal)
  const isGit = topLevel?.exitCode === 0
  const root = isGit ? await realpath(topLevel.stdout.trim()) : requestedRoot
  const initialIdentity = isGit ? await gitIdentity(root, signal) : { head: null, branch: null }
  const initialGitFiles = isGit ? await listGitFiles(root, signal) : null
  if (isGit && !initialGitFiles) throw new Error('Git workspace changed while fingerprinting; verification scope is unavailable')
  const exclusions = await workspaceExclusions(root, excludedPaths)

  const listedFiles = await listSourceFiles(root, initialGitFiles, signal)
  const candidates = listedFiles.filter(file => !file.split(/[\\/]/).some(part => EXCLUDED.has(part)) && !isExcludedWorkspaceFile(file, exclusions.roots)).sort()
  if (candidates.length > MAX_FILES) throw new Error('Workspace fingerprint exceeds 10000 files; verification scope is unavailable')
  // Keep the unfiltered candidate set long enough to notice sensitive symlinks.
  // Silently excluding one could let compilers follow it as an untracked input.
  const files: string[] = []
  const digest = createHash('sha256')
  digest.update(JSON.stringify({ schema: 'workspace_version_v2', cwd: requestedRoot, root, ...initialIdentity, exclusions: exclusions.identity })).update('\0')
  const identities = new Map<string, string>()
  const fileDigests = options.includeFileDigests ? new Map<string, string>() : undefined
  const listed = new Set(candidates.map(file => file.split(sep).join('/')))

  for (const file of candidates) {
    signal?.throwIfAborted()
    const target = resolve(root, file)
    await assertSafeParentChain(root, target)
    let before
    try { before = await lstat(target, { bigint: true }) }
    catch (error) { throw new Error(`Workspace changed while fingerprinting: ${file}`, { cause: error }) }
    const sensitive = isSensitiveWorkspacePath(file)
    if (sensitive && before.isSymbolicLink()) {
      throw new Error(`Sensitive symlink is outside the verification scope: ${file}`)
    }
    if (sensitive) continue
    digest.update(JSON.stringify(file)).update('\0')
    digest.update(String(before.mode)).update('\0')
    if (before.isSymbolicLink()) {
      const linkTarget = await readlink(target)
      const resolvedTarget = await realpath(target).catch(error => {
        throw new Error(`Workspace symlink target is unavailable: ${file}`, { cause: error })
      })
      if (!contained(root, resolvedTarget)) throw new Error(`Workspace symlink escapes verification root: ${file}`)
      const targetRelative = relative(root, resolvedTarget).split(sep).join('/')
      if (isSensitiveWorkspacePath(targetRelative)) throw new Error(`Workspace symlink targets sensitive input: ${file}`)
      if (!listed.has(targetRelative)) {
        throw new Error(`Workspace symlink target is not an enumerated source input: ${file}`)
      }
      const targetInfo = await lstat(resolvedTarget, { bigint: true })
      if (!targetInfo.isFile()) throw new Error(`Unsupported workspace symlink target: ${file}`)
      await assertSafeParentChain(root, resolvedTarget)
      const targetHash = await hashFileContent(resolvedTarget, undefined, signal)
      if (!HASH.test(targetHash)) throw new Error(`Workspace fingerprint hash unavailable: ${file}`)
      identities.set(targetRelative, statIdentity(targetInfo))
      const fileDigest = `link:${linkTarget}\0${targetRelative}\0${targetHash}`
      digest.update(fileDigest)
      fileDigests?.set(file.split(/[\\/]/).join('/'), `${before.mode}\0${fileDigest}`)
    }
    else if (before.isFile()) {
      const fileHash = await hashFileContent(target, undefined, signal)
      if (!HASH.test(fileHash)) throw new Error(`Workspace fingerprint hash unavailable: ${file}`)
      digest.update(fileHash)
      fileDigests?.set(file.split(/[\\/]/).join('/'), `${before.mode}\0${fileHash}`)
    } else throw new Error(`Unsupported verification input: ${file}`)
    const after = await lstat(target, { bigint: true }).catch(() => undefined)
    if (!after || statIdentity(before) !== statIdentity(after)) {
      throw new Error(`Workspace changed while fingerprinting: ${file}`)
    }
    identities.set(file, statIdentity(after))
    files.push(file)
    digest.update('\0')
  }

  const finalGitFiles = isGit ? await listGitFiles(root, signal) : null
  if ((isGit && (!finalGitFiles || !sameFiles(initialGitFiles!, finalGitFiles)))
    || (!isGit && !sameFiles(files, (await listSourceFiles(root, null, signal))
      .filter(file => !file.split(/[\\/]/).some(part => EXCLUDED.has(part)) && !isExcludedWorkspaceFile(file, exclusions.roots) && !isSensitiveWorkspacePath(file)).sort()))) {
    throw new Error('Workspace changed while fingerprinting; verification scope is unavailable')
  }
  const finalIdentity = isGit ? await gitIdentity(root, signal) : initialIdentity
  if (initialIdentity.head !== finalIdentity.head || initialIdentity.branch !== finalIdentity.branch) {
    throw new Error('Git revision changed while fingerprinting; verification scope is unavailable')
  }
  // Revalidate every hashed source after enumeration and Git identity checks.
  // Per-file checks alone can combine a new early file with an old late file.
  await assertCapturedWorkspaceInputsUnchanged(root, identities, signal)
  return { cwd: requestedRoot, root, head: finalIdentity.head, branch: finalIdentity.branch, digest: digest.digest('hex'), fileCount: files.length, ...(fileDigests ? { fileDigests } : {}) }
}
