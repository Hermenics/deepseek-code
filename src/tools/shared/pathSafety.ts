import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import type { FileVersion, ToolExecutionContext } from '../../orchestration/types.js'
import { acquireFileLease } from '../../orchestration/fileLease.js'
import { parseWorkflowSource } from '../../workflows/parser.js'
import { isPathIgnored, ignoredPathError } from './deepseekignore.js'
import { escapesRoot } from '../../utils/pathContainment.js'

/**
 * Non-negotiable safety core: always blocked even if .deepseekignore says
 * otherwise. Everything else that used to live here (node_modules, dist,
 * .claude, …) migrated to .deepseekignore — see deepseekignore.ts.
 */
export const BLOCKED_DIRS = ['.deepseek', '.git']

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i, /.*\.pem$/i, /.*\.key$/i, /.*\.p12$/i, /.*\.pfx$/i,
  /^credentials(\.json)?$/i, /^secrets?(\.json|\.yaml|\.yml|\.toml)?$/i,
  /^\.netrc$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /^known_hosts$/i, /^service.?account.*\.json$/i, /^gcloud.*\.json$/i,
  /(?:^|\/)\.aws\/(credentials|config)$/i,
]

// Native recursive grep must exclude these names before opening files; keep them aligned with SENSITIVE_FILE_PATTERNS.
const SENSITIVE_GREP_FILE_GLOBS = [
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx',
  'credentials', 'credentials.json', 'secret', 'secrets', 'secret.json', 'secret.yaml', 'secret.yml', 'secret.toml',
  'secrets.json', 'secrets.yaml', 'secrets.yml', 'secrets.toml',
  '.netrc', '.npmrc', '.pypirc', 'id_rsa', 'id_rsa.pub', 'id_ed25519', 'id_ed25519.pub',
  'id_ecdsa', 'id_ecdsa.pub', 'id_dsa', 'id_dsa.pub', 'known_hosts',
  'serviceaccount*.json', 'service?account*.json', 'gcloud*.json',
].map(pattern => pattern.replace(/[a-z]/gi, char => `[${char.toLowerCase()}${char.toUpperCase()}]`))

export const SENSITIVE_GREP_EXCLUDE_ARGS = [
  ...SENSITIVE_GREP_FILE_GLOBS.map(pattern => `--exclude=${pattern}`),
  `--exclude-dir=${'.aws'.replace(/[a-z]/gi, char => `[${char.toLowerCase()}${char.toUpperCase()}]`)}`,
]

/** True for credential-like files (.env, keys, certificates, cloud credentials, .npmrc...), matched on the basename or the slash-normalized path. Agents are never allowed to touch these. */
export function isSensitiveWorkspacePath(filePath: string): boolean {
  const basename = path.basename(filePath)
  const normalized = filePath.replace(/\\/g, '/')
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(basename) || pattern.test(normalized))
}

/** True when `target` is `root` or inside it. Lexical only (no symlink resolution); a child whose name starts with `..` is also treated as outside. */
function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || !escapesRoot(relative)
}

/** Matches `.deepseek/workflows/<name>.js`, the one exception to the `.deepseek/` block. */
function isWorkflowFile(relativePath: string): boolean {
  return /^\.deepseek\/workflows\/[^/]+\.js$/.test(relativePath.replace(/\\/g, '/'))
}

/** Canonical path of an existing target, or nearest real ancestor plus the missing tail for a new file. */
async function canonicalTargetPath(target: string): Promise<string> {
  const missing: string[] = []
  let current = target
  while (true) {
    try {
      return path.join(await fs.realpath(current), ...missing)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing.unshift(path.basename(current))
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

/** Runtime exclusions outrank workspace and external-directory grants; aliases remain excluded. */
export async function isProtectedPath(target: string, context?: ToolExecutionContext): Promise<boolean> {
  if (!context?.protectedPaths?.length) return false
  const absolute = path.resolve(target)
  const canonical = await canonicalTargetPath(absolute)
  const roots = await Promise.all(context.protectedPaths.map(async root => {
    const absoluteRoot = path.resolve(root)
    return { absolute: absoluteRoot, canonical: await canonicalTargetPath(absoluteRoot) }
  }))
  for (const root of roots) {
    if (isContained(root.absolute, absolute) || isContained(root.canonical, canonical)) return true
  }

  let targetStat: Awaited<ReturnType<typeof fs.stat>>
  try {
    targetStat = await fs.stat(absolute, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (!targetStat.isFile()) return false
  for (const root of roots) {
    try {
      const protectedStat = await fs.stat(root.absolute, { bigint: true })
      if (protectedStat.isFile() && targetStat.dev === protectedStat.dev && targetStat.ino === protectedStat.ino) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return false
}

/** True when `target`, after resolving symlinks, is a saved workflow script inside this workspace's `.deepseek/workflows/`. */
async function isWorkspaceWorkflowFile(workspaceRoot: string, target: string): Promise<boolean> {
  if (!isContained(workspaceRoot, target)) return false
  const realRoot = await fs.realpath(workspaceRoot)
  const canonical = await canonicalTargetPath(target)
  return isContained(realRoot, canonical) && isWorkflowFile(path.relative(realRoot, canonical))
}

/** Resolve a path exactly as tool execution will resolve it, without granting access. */
export function resolvePathForContext(filePath: string, context?: ToolExecutionContext): string {
  const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())
  const projectRoot = path.resolve(context?.projectRoot ?? workspaceRoot)
  if (!path.isAbsolute(filePath)) return path.resolve(workspaceRoot, filePath)
  const absolutePath = path.resolve(filePath)
  if (isContained(workspaceRoot, absolutePath)) return absolutePath
  // Linux shell diagnostics use this workspace alias; access checks still run on the host target.
  if (process.platform === 'linux' && context?.workspacePath && isContained('/mnt', absolutePath)) {
    return path.resolve(workspaceRoot, path.relative('/mnt', absolutePath))
  }
  if (isContained(projectRoot, absolutePath)) return path.resolve(workspaceRoot, path.relative(projectRoot, absolutePath))
  return absolutePath
}

/** realpath of `target`, or of its closest existing ancestor when the path does not exist yet. */
async function nearestExisting(target: string): Promise<string> {
  let current = target
  while (true) {
    try { return await fs.realpath(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

/** Resolves, translates and validates a path. Callers must use the returned path. */
export async function resolveSafePath(filePath: string, context?: ToolExecutionContext): Promise<string> {
  const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())
  const target = resolvePathForContext(filePath, context)
  if (await isProtectedPath(target, context)) throw new Error('Private runtime state cannot be accessed by general file tools')
  const roots = [workspaceRoot, ...(context?.approvedExternalPaths ?? []).map(root => path.resolve(root))]
  const realAncestor = await nearestExisting(target)
  const allowedRoot = await Promise.all(roots.map(async root => ({ root, realRoot: await fs.realpath(root) })))
    .then(candidates => candidates.find(candidate => isContained(candidate.realRoot, realAncestor))
      ?? candidates.find(candidate => isContained(candidate.root, target)))
  if (!allowedRoot) {
    throw new Error(`Path '${filePath}' is outside the working directory; outside the task workspace (${workspaceRoot})`)
  }
  if (!isContained(allowedRoot.realRoot, realAncestor)) {
    throw new Error(`Path '${filePath}' escapes its approved directory through a symlink`)
  }
  const canonicalRelative = path.relative(allowedRoot.realRoot, realAncestor)
  const canonicalTopDir = canonicalRelative.split(path.sep)[0]
  const relative = path.relative(allowedRoot.root, target)
  const workspaceRelative = path.relative(workspaceRoot, target)
  const workspacePath = isContained(workspaceRoot, target)
  const workflowFile = allowedRoot.root === workspaceRoot && await isWorkspaceWorkflowFile(workspaceRoot, target)
  if (canonicalTopDir && BLOCKED_DIRS.includes(canonicalTopDir) && !workflowFile) throw new Error(`Directory '${canonicalTopDir}/' is off-limits`)
  if (isSensitiveWorkspacePath(canonicalRelative)) throw new Error(`File '${path.basename(realAncestor)}' is sensitive and cannot be accessed by an agent`)

  const topDir = relative.split(path.sep)[0]
  if (topDir && BLOCKED_DIRS.includes(topDir) && !workflowFile) throw new Error(`Directory '${topDir}/' is off-limits`)
  const workspaceTopDir = workspaceRelative.split(path.sep)[0]
  if (workspacePath && workspaceTopDir && BLOCKED_DIRS.includes(workspaceTopDir) && !workflowFile) throw new Error(`Directory '${workspaceTopDir}/' is off-limits`)
  if (isSensitiveWorkspacePath(relative)) throw new Error(`File '${path.basename(filePath)}' is sensitive and cannot be accessed by an agent`)
  // .deepseekignore (or built-in defaults when absent) — checked on the
  // requested path AND its canonical form so symlinks can't dodge it
  if (workspacePath && !workflowFile) {
    if (isPathIgnored(target, workspaceRoot)) throw ignoredPathError(filePath, workspaceRoot)
    if (allowedRoot.root === workspaceRoot && isPathIgnored(path.resolve(workspaceRoot, canonicalRelative), workspaceRoot)) {
      throw ignoredPathError(filePath, workspaceRoot)
    }
  }
  return target
}

/** Canonical existing directory that can contain the requested path after approval. */
export async function resolveExternalApprovalDirectory(filePath: string, isDirectory: boolean, context?: ToolExecutionContext): Promise<string> {
  const target = resolvePathForContext(filePath, context)
  const requestedDirectory = isDirectory ? target : path.dirname(target)
  const existing = await nearestExisting(requestedDirectory)
  const stat = await fs.stat(existing)
  return stat.isDirectory() ? existing : path.dirname(existing)
}

/** Validate a file path for tool access; alias of `resolveSafePath`. Use the returned path, not the input. */
export async function assertSafePath(filePath: string, context?: ToolExecutionContext): Promise<string> {
  return resolveSafePath(filePath, context)
}

/** Validate a directory path for tool access; alias of `resolveSafePath`. Use the returned path, not the input. */
export async function assertSafeDir(dirPath: string, context?: ToolExecutionContext): Promise<string> {
  return resolveSafePath(dirPath, context)
}

/** BLOCKED_DIRS turned into recursive "any depth" glob excludes, one per directory. */
export const BLOCKED_GLOB_PATTERNS = BLOCKED_DIRS.map(directory => `**/${directory}/**`)

/** Check cancellation at execution boundaries; filesystem operations already submitted may finish. */
export function assertExecutionActive(context?: ToolExecutionContext): void {
  if (context?.signal?.aborted) throw context.signal.reason ?? new Error('Task execution was cancelled')
}

export async function hashFileContent(filePath: string, onChunk?: (chunk: Buffer) => void, signal?: AbortSignal, maxBytes?: number): Promise<string> {
  const digest = createHash('sha256')
  let bytesRead = 0
  for await (const rawChunk of createReadStream(filePath, signal ? { signal } : {})) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    // shortcut: one stream chunk may be read past the cap before rejection; use range-limited reads if exact device I/O bounds become necessary.
    if (maxBytes !== undefined && bytesRead + chunk.length > maxBytes) throw new RangeError('File hash byte limit exceeded')
    bytesRead += chunk.length
    digest.update(chunk)
    onChunk?.(chunk)
  }
  return digest.digest('hex')
}

async function assertExpectedFileVersion(filePath: string, expected: FileVersion, signal?: AbortSignal): Promise<void> {
  let handle: fs.FileHandle
  try { handle = await fs.open(filePath, 'r') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (!expected.exists) return
    throw new Error('File changed since it was read; read it again before writing')
  }
  let currentHash: string
  try {
    const opened = await handle.stat({ bigint: true })
    const digest = createHash('sha256')
    for await (const rawChunk of createReadStream(filePath, { fd: handle.fd, autoClose: false, signal })) {
      digest.update(Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk))
    }
    currentHash = digest.digest('hex')
    const readFinished = await handle.stat({ bigint: true })
    let targetNow: Awaited<ReturnType<typeof handle.stat>>
    try { targetNow = await fs.stat(filePath, { bigint: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new Error('File changed since it was read; read it again before writing')
    }
    if (opened.dev !== readFinished.dev || opened.ino !== readFinished.ino
      || opened.size !== readFinished.size || opened.mtimeNs !== readFinished.mtimeNs || opened.ctimeNs !== readFinished.ctimeNs
      || opened.dev !== targetNow.dev || opened.ino !== targetNow.ino
      || opened.size !== targetNow.size || opened.mtimeNs !== targetNow.mtimeNs || opened.ctimeNs !== targetNow.ctimeNs) {
      throw new Error('File changed since it was read; read it again before writing')
    }
  } finally {
    await handle.close()
  }
  if (!expected.exists || currentHash !== expected.hash) {
    throw new Error('File changed since it was read; read it again before writing')
  }
}

/** Serialize, stage and atomically publish a context-authorized file write. */
export async function atomicWriteFile(filePath: string, content: string, context?: ToolExecutionContext, expectedFileVersion = context?.expectedFileVersion): Promise<string> {
  if (!expectedFileVersion) throw new Error('Write requires an expected file version')
  const safePath = await resolveSafePath(filePath, context)
  if (await isWorkspaceWorkflowFile(path.resolve(context?.workspacePath ?? process.cwd()), safePath)) parseWorkflowSource(content)
  const lease = await acquireFileLease(`file:${safePath}`, { sessionId: context?.sessionId, taskId: context?.taskId }, context?.signal)
  let temporary: string | undefined
  try {
    assertExecutionActive(context)
    await fs.mkdir(path.dirname(safePath), { recursive: true })
    let mode = 0o600
    try { mode = (await fs.stat(safePath)).mode } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    temporary = path.join(path.dirname(safePath), `.${path.basename(safePath)}.${process.pid}.${randomUUID()}.tmp`)
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode, signal: context?.signal })
    assertExecutionActive(context)
    if (await resolveSafePath(safePath, context) !== safePath) throw new Error('Write target changed during authorization')
    assertExecutionActive(context)
    // Stable-handle revalidation catches swaps during hashing, but cannot CAS against a writer racing the final stat and rename.
    await assertExpectedFileVersion(safePath, expectedFileVersion, context?.signal)
    assertExecutionActive(context)
    if (!expectedFileVersion.exists) {
      // link() publishes the complete staged file only if a racing writer has not created the target.
      try { await fs.link(temporary, safePath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('File changed since it was read; read it again before writing')
        throw error
      }
      await fs.unlink(temporary).catch(() => undefined)
    } else {
      await fs.rename(temporary, safePath)
      temporary = undefined
    }
    const contentHash = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
    await context?.onFileWriteCommitted?.(safePath, { exists: true, hash: contentHash })
    if (context?.taskId && context.effectId && context.markEffectOutcome) {
      const pathHash = createHash('sha256').update(safePath).digest('hex')
      try {
        await context.markEffectOutcome(context.effectId, 'effect-observed', `file-write:${pathHash}:${contentHash}`)
      } catch {
        const error = new Error('File was written, but its delegated effect receipt could not be saved. Inspect it before retrying.')
        Object.assign(error, {
          code: 'FILE_EFFECT_RECEIPT_PERSIST_FAILED',
          partial: { state: 'effect-observed', receipt: 'not-persisted', pathHash, contentHash },
        })
        throw error
      }
    }
    return safePath
  } finally {
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined)
    await lease.release()
  }
}

/** Delete a file under the same lease and version precondition used for atomic writes. */
export async function atomicDeleteFile(filePath: string, context?: ToolExecutionContext): Promise<string> {
  const safePath = await resolveSafePath(filePath, context)
  const lease = await acquireFileLease(`file:${safePath}`, { sessionId: context?.sessionId, taskId: context?.taskId }, context?.signal)
  try {
    assertExecutionActive(context)
    if (await resolveSafePath(safePath, context) !== safePath) throw new Error('Delete target changed during authorization')
    // Stable-handle revalidation catches swaps during hashing, but cannot CAS against a writer racing the final stat and unlink.
    if (!context?.expectedFileVersion) throw new Error('Delete requires an expected file version')
    await assertExpectedFileVersion(safePath, context.expectedFileVersion, context.signal)
    if (context?.expectedFileVersion?.exists === false) return safePath
    assertExecutionActive(context)
    await fs.unlink(safePath)
    await context?.onFileWriteCommitted?.(safePath, {
      exists: false,
      hash: createHash('sha256').update('').digest('hex'),
    })
    return safePath
  } finally {
    await lease.release()
  }
}
