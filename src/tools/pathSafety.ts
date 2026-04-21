import * as fs from 'fs/promises'
import * as path from 'path'

export const BLOCKED_DIRS = [
  '.agent',
  '.claude',
  '.kiro',
  '.github',
  'node_modules',
  'dist',
  'build',
  '.git',
]

/**
 * Validates that a file path is safe to access:
 * 1. Must be inside the current working directory
 * 2. Must not be inside a blocked directory
 * 3. Must not escape via symlinks
 */
export async function assertSafePath(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath)
  const cwd = process.cwd()

  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    throw new Error(`Path '${filePath}' is outside the working directory`)
  }

  // Resolve symlinks to prevent traversal attacks
  try {
    const real = await fs.realpath(resolved)
    if (!real.startsWith(cwd + path.sep) && real !== cwd) {
      throw new Error(`Path '${filePath}' resolves outside the working directory (symlink traversal blocked)`)
    }
  } catch (e) {
    // ENOENT = file doesn't exist yet (e.g. write_file creating new file) — safe to skip realpath
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  const relative = path.relative(cwd, resolved)
  const topDir = relative.split(path.sep)[0]
  if (topDir && BLOCKED_DIRS.includes(topDir)) {
    throw new Error(`Directory '${topDir}/' is off-limits. Use read_folder to see available directories.`)
  }
}

/**
 * Validates that a directory path is safe to use as cwd/search root.
 * Same rules as assertSafePath but for directories.
 */
export async function assertSafeDir(dirPath: string): Promise<void> {
  return assertSafePath(dirPath)
}

/** Glob ignore patterns derived from BLOCKED_DIRS */
export const BLOCKED_GLOB_PATTERNS = BLOCKED_DIRS.map((d) => `**/${d}/**`)
