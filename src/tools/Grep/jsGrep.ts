import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import fg from 'fast-glob'
import { isPathIgnored } from '../shared/deepseekignore.js'

/** Files larger than this are skipped — they are data, not source. */
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** A NUL byte in the first chunk is the usual "this is binary" heuristic. */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0)
}

/**
 * Pure-JS grep, used when the `grep` binary is unavailable (Windows) or the
 * platform's grep lacks the flags we rely on.
 *
 * Deliberately mirrors the binary's output shape (`file:line:text`) so the
 * model sees one format everywhere. Patterns use POSIX BRE syntax, matching
 * the default dialect used by native grep.
 */
function escapeRegexChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char
}

/** Translate the portable BRE operators that differ from JavaScript syntax. */
export function breToRegExpSource(pattern: string): string {
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!
    if (char === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end !== -1) {
        source += pattern.slice(i, end + 1)
        i = end
        continue
      }
    }
    if (char === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i]!
      if (next === '{') {
        const end = pattern.indexOf('\\}', i + 1)
        const interval = end === -1 ? '' : pattern.slice(i + 1, end)
        if (/^\d+(,\d*)?$/.test(interval)) {
          source += `{${interval}}`
          i = end + 1
        } else {
          source += '\\{'
        }
      } else if ('()|+?'.includes(next)) {
        source += next
      } else {
        source += escapeRegexChar(next)
      }
      continue
    }
    source += '()|+?{}'.includes(char) ? `\\${char}` : char
  }
  return source
}

export async function jsGrep(options: {
  dir: string
  pattern: string
  include?: string | undefined
  workspaceRoot: string
  ignoreDirs: string[]
  limit: number
  signal?: AbortSignal | undefined
}): Promise<{ lines: string[]; totalMatches?: number; error?: string }> {
  const { dir, pattern, include, workspaceRoot, ignoreDirs, limit, signal } = options

  if (signal?.aborted) return { lines: [] }

  let regex: RegExp
  try {
    regex = new RegExp(breToRegExpSource(pattern))
  } catch (err) {
    return { lines: [], error: `Invalid pattern: ${(err as Error).message}` }
  }

  const files = await fg(include ? `**/${include}` : '**/*', {
    cwd: dir,
    dot: true,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: ignoreDirs.map((d) => `**/${d}/**`),
  })
  if (signal?.aborted) return { lines: [] }

  const lines: string[] = []
  let totalMatches = 0
  const maxStoredMatches = Math.max(0, limit) + 1
  for (const file of files) {
    if (signal?.aborted) break
    if (isPathIgnored(file, workspaceRoot)) continue

    let content: Buffer
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
      if (signal?.aborted) break
      content = await fs.readFile(file)
    } catch {
      continue // unreadable (permissions, race) — grep skips these too
    }
    if (looksBinary(content)) continue

    const relative = path.relative(dir, file) || path.basename(file)
    const display = path.join(dir, relative)
    const text = content.toString('utf8')
    let lineNumber = 0
    for (const line of text.split('\n')) {
      lineNumber++
      regex.lastIndex = 0
      if (regex.test(line)) {
        totalMatches += 1
        if (lines.length < maxStoredMatches) lines.push(`${display}:${lineNumber}:${line}`)
      }
    }
  }

  return { lines, totalMatches }
}
