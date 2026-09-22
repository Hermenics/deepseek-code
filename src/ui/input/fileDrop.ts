import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'

/** Strips shell backslash escapes. On Windows a backslash is kept unless it escapes whitespace, a quote or another backslash, since it is also the path separator there. */
function unescapePath(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char !== '\\' || i === value.length - 1) {
      result += char
      continue
    }
    const next = value[++i]!
    if (process.platform === 'win32' && !/[\s"'\\]/.test(next)) result += '\\'
    result += next
  }
  return result
}

/** Turns one dropped token into a path: resolves file:// URLs ('' if invalid), strips surrounding quotes and shell escapes, and keeps the leading \\ of quoted Windows UNC paths. */
function decodePath(value: string): string {
  let candidate = value.trim()
  if (/^file:\/\//i.test(candidate)) {
    try { return fileURLToPath(candidate) } catch { return '' }
  }
  
  // Check if this is a quoted UNC path (starts with "\\" inside quotes)
  // We need to preserve the leading \\ before unescaping
  let isQuotedUNC = false
  if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
    const inner = candidate.slice(1, -1)
    if (process.platform === 'win32' && inner.startsWith('\\\\')) {
      isQuotedUNC = true
    }
    candidate = inner
  }
  
  // For quoted UNC paths, preserve the \\ prefix before unescaping
  if (isQuotedUNC) {
    return '\\\\' + unescapePath(candidate.slice(2))
  }
  
  return unescapePath(candidate)
}

/** Splits a multi-file drop into paths using shell-style quotes and backslash escapes, decoding each token with decodePath. */
function splitShellPaths(value: string): string[] {
  const paths: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  const push = () => {
    if (token) paths.push(decodePath(token))
    token = ''
  }

  for (const char of value) {
    if (escaped) {
      token += `\\${char}`
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (char === quote) quote = null
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      push()
    } else {
      token += char
    }
  }
  if (escaped) token += '\\'
  push()
  return paths
}

function isExistingAbsolutePath(value: string): boolean {
  return isAbsolute(value) && existsSync(value)
}

/** Converts the path text emitted by terminal file drops into a usable path. */
export function normalizeDroppedPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (isExistingAbsolutePath(trimmed)) return trimmed
  const direct = decodePath(trimmed)
  if (isExistingAbsolutePath(direct)) return direct

  const candidates = splitShellPaths(trimmed)
  if (candidates.length === 0 || candidates.some((candidate) => !isExistingAbsolutePath(candidate))) return null
  return candidates.join(' ')
}

/** Inserts a dropped path at `offset`, padding with spaces so it never sticks to neighbouring text; returns the new text and the offset just after the insertion. */
export function insertDroppedPath(text: string, offset: number, droppedPath: string): { text: string; offset: number } {
  const before = text.slice(0, offset)
  const after = text.slice(offset)
  const prefix = before && !/\s$/.test(before) ? ' ' : ''
  const suffix = after && !/^\s/.test(after) ? ' ' : ''
  const insertion = `${prefix}${droppedPath}${suffix}`
  return { text: before + insertion + after, offset: offset + insertion.length }
}
