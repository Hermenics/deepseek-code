import { realpath, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { ToolExecutionContext } from '../orchestration/types.js'
import {
  BLOCKED_DIRS,
  isSensitiveWorkspacePath,
  resolvePathForContext,
  resolveSafePath,
} from '../tools/shared/pathSafety.js'

export interface AdditionalDirectoriesOptions {
  workspacePath: string
}

/** Session-scoped, explicitly approved directory roots for multi-root access. */
export class AdditionalDirectories {
  private readonly workspacePath: string
  private readonly approved = new Set<string>()

  constructor(options: AdditionalDirectoriesOptions | string) {
    const workspacePath = typeof options === 'string' ? options : options.workspacePath
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      throw new TypeError('workspacePath must be a non-empty string')
    }
    this.workspacePath = path.resolve(workspacePath)
  }

  /** Validate and approve one existing directory, returning its canonical path. */
  async add(directoryPath: string): Promise<string> {
    const input = validateInput(directoryPath)
    rejectTraversal(input)

    const context = this.validationContext()
    const target = resolvePathForContext(input, context)
    const canonical = await existingDirectory(target, input)
    rejectSensitiveOrBlocked(canonical)

    // The candidate root is temporary validation context, not a global grant.
    await resolveSafePath(canonical, { ...context, approvedExternalPaths: [canonical] })
    this.approved.add(canonical)
    return canonical
  }

  /** Return a snapshot so callers cannot mutate the approval set. */
  list(): string[] {
    return [...this.approved]
  }

  /** Remove one exact canonical root; returns it when it was approved. */
  async remove(directoryPath: string): Promise<string | undefined> {
    const input = validateInput(directoryPath)
    rejectTraversal(input)
    const target = resolvePathForContext(input, this.validationContext())
    let canonical: string
    try {
      canonical = await realpath(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      canonical = target
    }
    return this.approved.delete(canonical) ? canonical : undefined
  }

  private validationContext(): ToolExecutionContext {
    return {
      sessionId: 'additional-directories-validation',
      workspacePath: this.workspacePath,
      projectRoot: this.workspacePath,
      permissionProfile: 'coordinator-integrator',
    }
  }
}

function validateInput(directoryPath: string): string {
  if (typeof directoryPath !== 'string' || !directoryPath.trim()) {
    throw new TypeError('directoryPath must be a non-empty string')
  }
  return directoryPath.trim()
}

function rejectTraversal(directoryPath: string): void {
  if (directoryPath.replace(/\\/g, '/').split('/').includes('..')) {
    throw new Error(`Path '${directoryPath}' contains traversal and cannot be approved`)
  }
}

async function existingDirectory(target: string, displayPath: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory '${displayPath}' does not exist`)
    }
    throw error
  }
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error(`Path '${displayPath}' is not a directory`)
  }
  return canonical
}

function rejectSensitiveOrBlocked(directoryPath: string): void {
  const segments = directoryPath.replace(/\\/g, '/').split('/').filter(Boolean)
  const blocked = segments.find(segment => BLOCKED_DIRS.includes(segment))
  if (blocked) throw new Error(`Directory '${blocked}/' is off-limits`)
  if (isSensitiveWorkspacePath(directoryPath) || segments.some(segment => isSensitiveWorkspacePath(segment))) {
    throw new Error(`Directory '${path.basename(directoryPath)}' is sensitive and cannot be approved`)
  }
}
