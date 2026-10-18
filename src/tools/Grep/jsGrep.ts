import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import fg from 'fast-glob'
import { isPathIgnored } from '../shared/deepseekignore.js'
import { isSensitiveWorkspacePath } from '../shared/pathSafety.js'
import { GREP_MAX_RESULT_BYTES } from '../../constants.js'
import { formatGrepMatch, type GrepMatch } from './matchOutput.js'

/** Files larger than this are skipped — they are data, not source. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
const REGEX_BATCH_SIZE = 16
const REGEX_BATCH_TIMEOUT_MS = 1000

const REGEX_MATCHER_SOURCE = `
const { createInterface } = require('node:readline')
let regex
createInterface({ input: process.stdin }).on('line', line => {
  const { id, type, source, lines } = JSON.parse(line)
  try {
    if (type === 'init') regex = new RegExp(source)
    else {
      const matches = []
      for (let i = 0; i < lines.length; i += 1) {
        regex.lastIndex = 0
        if (regex.test(lines[i])) matches.push(i)
      }
      process.stdout.write(JSON.stringify({ id, matches }) + '\\n')
      return
    }
    process.stdout.write(JSON.stringify({ id }) + '\\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ id, error: error.message }) + '\\n')
  }
})
`

interface RegexMatcherResponse {
  id: number | 'ready'
  matches?: number[]
  error?: string
}

interface RegexMatcherProcess {
  child: ChildProcessWithoutNullStreams
  reader: ReadlineInterface
  responses: AsyncIterator<string>
}

function startRegexMatcher(): RegexMatcherProcess {
  const child = spawn(process.execPath, ['--eval', REGEX_MATCHER_SOURCE], { stdio: 'pipe' })
  child.stderr.resume()
  const reader = createInterface({ input: child.stdout })
  return { child, reader, responses: reader[Symbol.asyncIterator]() }
}

function requestRegexMatcher(
  matcher: RegexMatcherProcess,
  message: { id: number | 'ready'; type: 'init' | 'match'; source?: string; lines?: string[] },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RegexMatcherResponse | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined)
  if (matcher.child.exitCode !== null || matcher.child.signalCode !== null) {
    return Promise.reject(new Error('Regex matcher process has exited'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const response = (async () => {
      const next = await matcher.responses.next()
      if (next.done) throw new Error('Regex matcher process exited before responding')
      const result = JSON.parse(next.value) as RegexMatcherResponse
      if (result.id !== message.id) throw new Error('Regex matcher returned an unexpected response')
      if (result.error) throw new Error(result.error)
      return result
    })()
    const timer = setTimeout(() => {
      matcher.child.kill()
      finish(() => reject(new Error(`Pattern matching exceeded ${timeoutMs} ms`)))
    }, timeoutMs)
    const onAbort = () => {
      matcher.child.kill()
      finish(() => resolve(undefined))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    response.then(
      result => finish(() => resolve(result)),
      error => finish(() => reject(error)),
    )
    matcher.child.stdin.write(`${JSON.stringify(message)}\n`, error => {
      if (error) finish(() => reject(error))
    })
  })
}

async function stopRegexMatcher(matcher: RegexMatcherProcess): Promise<void> {
  const { child } = matcher
  if (child.exitCode === null && child.signalCode === null) {
    child.kill()
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 500)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  matcher.reader.close()
}

/*
 * Matching runs in a separate process because some runtimes cannot interrupt
 * a CPU-bound RegExp call with Worker.terminate().
 */

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

/** Walk `dir` and return `file:line:text` matches, skipping ignored, binary and oversized files. Stores at most `limit + 1` lines but counts every match in `totalMatches`. */
export async function jsGrep(options: {
  dir: string
  pattern: string
  include?: string | undefined
  workspaceRoot: string
  ignoreDirs: string[]
  limit: number
  offset?: number
  signal?: AbortSignal | undefined
  exclude?: (file: string) => Promise<boolean>
}): Promise<{ lines: string[]; matches: GrepMatch[]; totalMatches?: number; matchSetHash?: string; error?: string }> {
  const { dir, pattern, include, workspaceRoot, ignoreDirs, limit, offset = 0, signal } = options

  if (signal?.aborted) return { lines: [], matches: [] }

  let regex: RegExp
  try {
    regex = new RegExp(breToRegExpSource(pattern))
  } catch (err) {
    return { lines: [], matches: [], error: `Invalid pattern: ${(err as Error).message}` }
  }

  const files = (await fg(include ? `**/${include}` : '**/*', {
    cwd: dir,
    dot: true,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: ignoreDirs.map((d) => `**/${d}/**`),
  })).sort()
  if (signal?.aborted) return { lines: [], matches: [] }

  const regexMatcher = startRegexMatcher()
  let requestId = 0
  let ready: RegexMatcherResponse | undefined
  try {
    ready = await requestRegexMatcher(regexMatcher, { id: 'ready', type: 'init', source: regex.source }, 5000, signal)
  } catch (err) {
    await stopRegexMatcher(regexMatcher)
    return { lines: [], matches: [], error: `Regex matching failed: ${(err as Error).message}` }
  }
  if (!ready) {
    await stopRegexMatcher(regexMatcher)
    return { lines: [], matches: [] }
  }

  const lines: string[] = []
  const matches: GrepMatch[] = []
  const matchSetHash = createHash('sha256')
  let totalMatches = 0
  let storedBytes = 0
  let storageFull = false
  const maxStoredMatches = Math.max(0, limit) + 1
  try {
    for (const file of files) {
      if (signal?.aborted) break
      if (isPathIgnored(file, workspaceRoot)) continue
      if (isSensitiveWorkspacePath(file)) continue
      if (await options.exclude?.(file)) continue

      let content: Buffer
      try {
        const stat = await fs.lstat(file)
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
        if (signal?.aborted) break
        content = await fs.readFile(file)
      } catch {
        continue // unreadable (permissions, race) — grep skips these too
      }
      if (looksBinary(content)) continue

      const relative = path.relative(dir, file) || path.basename(file)
      const display = path.join(dir, relative)
      const fileLines = content.toString('utf8').split('\n')
      for (let start = 0; start < fileLines.length; start += REGEX_BATCH_SIZE) {
        if (signal?.aborted) break
        const batch = fileLines.slice(start, start + REGEX_BATCH_SIZE)
        let matchedIndexes: number[]
        try {
          const response = await requestRegexMatcher(regexMatcher, { id: ++requestId, type: 'match', lines: batch }, REGEX_BATCH_TIMEOUT_MS, signal)
          if (!response) break
          matchedIndexes = response.matches ?? []
        } catch (err) {
          return { lines, matches, totalMatches, error: `Regex matching failed: ${(err as Error).message}` }
        }

        for (const index of matchedIndexes) {
          const line = batch[index]!
          const lineNumber = start + index + 1
          totalMatches += 1
          matchSetHash.update(JSON.stringify([display, lineNumber, line])).update('\0')
          if (totalMatches > offset && lines.length < maxStoredMatches && !storageFull) {
            const match = formatGrepMatch(display, lineNumber, line)
            const bytes = Buffer.byteLength(match.formatted) + (lines.length ? 1 : 0)
            if (storedBytes + bytes <= GREP_MAX_RESULT_BYTES) {
              lines.push(match.formatted)
              matches.push(match)
              storedBytes += bytes
            } else {
              storageFull = true
            }
          }
        }
      }
    }
  } finally {
    await stopRegexMatcher(regexMatcher)
  }

  return { lines, matches, totalMatches, matchSetHash: matchSetHash.digest('hex') }
}
