import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { acquireFileLease } from '../../orchestration/fileLease.js'
import { parseWorkflowSource } from '../../workflows/parser.js'
import { isPathIgnored, ignoredPathError } from './deepseekignore.js'

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
  /^\.aws\/(credentials|config)$/i,
]

export function isSensitiveWorkspacePath(filePath: string): boolean {
  const basename = path.basename(filePath)
  const normalized = filePath.replace(/\\/g, '/')
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(basename) || pattern.test(normalized))
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

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
  if (isContained(projectRoot, absolutePath)) return path.resolve(workspaceRoot, path.relative(projectRoot, absolutePath))
  return absolutePath
}

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

export async function assertSafePath(filePath: string, context?: ToolExecutionContext): Promise<string> {
  return resolveSafePath(filePath, context)
}

export async function assertSafeDir(dirPath: string, context?: ToolExecutionContext): Promise<string> {
  return resolveSafePath(dirPath, context)
}

export const BLOCKED_GLOB_PATTERNS = BLOCKED_DIRS.map(directory => `**/${directory}/**`)

export function assertExecutionActive(context?: ToolExecutionContext): void {
  if (context?.signal?.aborted) throw context.signal.reason ?? new Error('Task execution was cancelled')
}

/** Serialize, stage and atomically publish a context-authorized file write. */
export async function atomicWriteFile(filePath: string, content: string, context?: ToolExecutionContext): Promise<string> {
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
    await fs.rename(temporary, safePath)
    temporary = undefined
    return safePath
  } finally {
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined)
    await lease.release()
  }
}
