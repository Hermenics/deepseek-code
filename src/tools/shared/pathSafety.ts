import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { acquireFileLease } from '../../orchestration/fileLease.js'

export const BLOCKED_DIRS = ['.agent', '.claude', '.kiro', '.github', '.deepseek', 'node_modules', 'dist', 'build', '.git']

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
  const projectRoot = path.resolve(context?.projectRoot ?? workspaceRoot)
  let target: string
  if (!path.isAbsolute(filePath)) {
    target = path.resolve(workspaceRoot, filePath)
  } else if (isContained(workspaceRoot, path.resolve(filePath))) {
    target = path.resolve(filePath)
  } else if (isContained(projectRoot, path.resolve(filePath))) {
    target = path.resolve(workspaceRoot, path.relative(projectRoot, path.resolve(filePath)))
  } else {
    target = path.resolve(filePath)
  }

  const realRoot = await fs.realpath(workspaceRoot)
  if (!isContained(workspaceRoot, target)) {
    throw new Error(`Path '${filePath}' is outside the working directory; outside the task workspace (${workspaceRoot})`)
  }
  const realAncestor = await nearestExisting(target)
  if (!isContained(realRoot, realAncestor)) {
    throw new Error(`Path '${filePath}' escapes the task workspace through a symlink`)
  }
  const canonicalRelative = path.relative(realRoot, realAncestor)
  const canonicalTopDir = canonicalRelative.split(path.sep)[0]
  if (canonicalTopDir && BLOCKED_DIRS.includes(canonicalTopDir)) throw new Error(`Directory '${canonicalTopDir}/' is off-limits`)
  if (isSensitiveWorkspacePath(canonicalRelative)) throw new Error(`File '${path.basename(realAncestor)}' is sensitive and cannot be accessed by an agent`)

  const relative = path.relative(workspaceRoot, target)
  const topDir = relative.split(path.sep)[0]
  if (topDir && BLOCKED_DIRS.includes(topDir)) throw new Error(`Directory '${topDir}/' is off-limits`)
  if (isSensitiveWorkspacePath(relative)) throw new Error(`File '${path.basename(filePath)}' is sensitive and cannot be accessed by an agent`)
  return target
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
