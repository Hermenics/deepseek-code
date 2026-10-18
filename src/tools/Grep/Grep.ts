import { Tool } from '../types.js'
import { execa } from 'execa'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { GREP_MAX_LINES, GREP_MAX_MATCH_CHARS, GREP_MAX_RESULT_BYTES } from '../../constants.js'
import { assertSafeDir, isProtectedPath, SENSITIVE_GREP_EXCLUDE_ARGS } from '../shared/pathSafety.js'
import { ignoreDirNames, isPathIgnored } from '../shared/deepseekignore.js'
import { hasBinary } from '../../utils/platform.js'
import { escapesRoot } from '../../utils/pathContainment.js'
import { jsGrep } from './jsGrep.js'
import { formatGrepMatch, type GrepMatch } from './matchOutput.js'
import { symbolPathForLine } from './symbols.js'
import { findLspServer } from '../../lsp.js'
import { Lsp } from '../Lsp/Lsp.js'
import { acquireFileLease, type FileLease } from '../../orchestration/fileLease.js'
import { formatToolError, isToolErrorResult, normalizeToolResult } from '../result.js'

const nativeGrepCapability = new Map<string, Promise<boolean>>()
interface GrepCursorState { queryHash: string; matchSetHash: string; offset: number; expiresAt: number }
type GrepCursorLookup = { kind: 'found'; state: GrepCursorState } | { kind: 'query-mismatch' } | { kind: 'missing' }
const grepCursors = new Map<string, GrepCursorState>()
const MAX_GREP_CURSORS = 128
const GREP_CURSOR_TTL_MS = 10 * 60_000
const MAX_SYMBOL_FILES_PER_PAGE = 4
const MAX_GREP_PATTERNS_PER_CALL = 25
// shortcut: cap native filenames at the Windows long-path limit; raise only if a supported platform exceeds it.
const MAX_NATIVE_FILENAME_CHARS = 32_768

/** Probe once per platform (cached) whether grep accepts the NUL filename separator the output parser relies on. */
async function supportsNativeGrep(): Promise<boolean> {
  const platform = process.platform
  // macOS grep accepts the probe flags but does not preserve the result contract with --include.
  if (platform === 'darwin') return false
  const cached = nativeGrepCapability.get(platform)
  if (cached) return cached

  const probe = (async () => {
    if (!hasBinary('grep')) return false
    try {
      await execa('grep', ['-rnZ', ...SENSITIVE_GREP_EXCLUDE_ARGS, '--', '', platform === 'win32' ? 'NUL' : '/dev/null'], { timeout: 3000 })
      return true
    } catch (error) {
      return (error as { exitCode?: number }).exitCode === 1
    }
  })()
  nativeGrepCapability.set(platform, probe)
  return probe
}

/** Detect grep exiting with status 2 because it rejected our flags, so the caller can fall back to the JS implementation. */
function unsupportedGrepOptions(error: unknown): boolean {
  const failure = error as { exitCode?: number; stderr?: string; message?: string }
  const text = `${failure.stderr || ''} ${failure.message || ''}`
  return failure.exitCode === 2 && /(invalid|unknown|unrecognized|illegal|unsupported).*option|usage:\s*grep/i.test(text)
}

async function readNativeGrepPage(
  output: AsyncIterable<Uint8Array>,
  workspaceRoot: string,
  offset: number,
  limit: number,
): Promise<{ matches: GrepMatch[]; totalMatches: number; matchSetHash: string }> {
  const decoder = new StringDecoder('utf8')
  const matchSetHash = createHash('sha256')
  const matches: GrepMatch[] = []
  let file = ''
  let match = ''
  let inFilename = true
  let filenameTooLong = false
  let matchTruncated = false
  let totalMatches = 0
  let resultBytes = 0
  let resultFull = false

  const finishMatch = () => {
    const lineNumberEnd = match.indexOf(':')
    if (filenameTooLong || lineNumberEnd < 1 || !/^\d+$/.test(match.slice(0, lineNumberEnd))) return
    if (isPathIgnored(path.resolve(file), workspaceRoot)) return

    totalMatches += 1
    if (totalMatches <= offset || matches.length >= limit || resultFull) return
    const formatted = formatGrepMatch(file, Number(match.slice(0, lineNumberEnd)), match.slice(lineNumberEnd + 1), matchTruncated)
    const bytes = Buffer.byteLength(formatted.formatted) + (matches.length ? 1 : 0)
    if (resultBytes + bytes > GREP_MAX_RESULT_BYTES) {
      resultFull = true
      return
    }
    matches.push(formatted)
    resultBytes += bytes
  }

  const consume = (chunk: string) => {
    for (const char of chunk) {
      if (inFilename) {
        if (char === '\0') {
          inFilename = false
        } else if (file.length < MAX_NATIVE_FILENAME_CHARS) {
          file += char
        } else {
          filenameTooLong = true
        }
      } else if (char === '\n') {
        finishMatch()
        file = ''
        match = ''
        inFilename = true
        filenameTooLong = false
        matchTruncated = false
      } else if (match.length < GREP_MAX_MATCH_CHARS) {
        match += char
      } else {
        matchTruncated = true
      }
    }
  }

  for await (const chunk of output) {
    const bytes = Buffer.from(chunk)
    matchSetHash.update(bytes)
    consume(decoder.write(bytes))
  }
  const tail = decoder.end()
  if (tail) consume(tail)
  if (!inFilename && match) finishMatch()
  return { matches, totalMatches, matchSetHash: matchSetHash.digest('hex') }
}

function pruneGrepCursorMap(cursors: Map<string, GrepCursorState>, now = Date.now()): boolean {
  let changed = false
  for (const [token, cursor] of cursors) {
    if (cursor.expiresAt <= now) { cursors.delete(token); changed = true }
  }
  while (cursors.size > MAX_GREP_CURSORS) {
    cursors.delete(cursors.keys().next().value!)
    changed = true
  }
  return changed
}

function validGrepCursorState(value: unknown): value is GrepCursorState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<GrepCursorState>
  return typeof state.queryHash === 'string' && /^[a-f0-9]{64}$/.test(state.queryHash)
    && typeof state.matchSetHash === 'string' && /^[a-f0-9]{64}$/.test(state.matchSetHash)
    && Number.isSafeInteger(state.offset) && state.offset! >= 0
    && Number.isSafeInteger(state.expiresAt) && state.expiresAt! > 0
}

function grepCursorFile(sessionId: string): string {
  const sessionKey = createHash('sha256').update(sessionId).digest('hex')
  return path.join(process.env.HOME || homedir(), '.deepseek', 'grep-cursors', `${sessionKey}.json`)
}

async function readPersistedGrepCursors(file: string): Promise<Map<string, GrepCursorState>> {
  const info = await lstat(file).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (!info) return new Map()
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Grep cursor store is not a regular file')
  await chmod(file, 0o600)
  try {
    const snapshot = JSON.parse(await readFile(file, 'utf8')) as { schemaVersion?: unknown; cursors?: unknown }
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.cursors) || snapshot.cursors.length > MAX_GREP_CURSORS) return new Map()
    const cursors = new Map<string, GrepCursorState>()
    for (const entry of snapshot.cursors) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !/^[0-9a-f-]{36}$/i.test(entry[0]) || !validGrepCursorState(entry[1]) || cursors.has(entry[0])) return new Map()
      cursors.set(entry[0], entry[1])
    }
    return cursors
  } catch (error) {
    if (error instanceof SyntaxError) return new Map()
    throw error
  }
}

async function writePersistedGrepCursors(file: string, cursors: Map<string, GrepCursorState>): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, cursors: [...cursors] })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

async function updatePersistedGrepCursors<T>(context: { sessionId?: string; signal?: AbortSignal } | undefined, update: (cursors: Map<string, GrepCursorState>) => { value: T; changed: boolean }): Promise<{ available: boolean; value?: T }> {
  if (!context?.sessionId) return { available: false }
  const file = grepCursorFile(context.sessionId)
  const directory = path.dirname(file)
  let lease: FileLease | undefined
  try {
    lease = await acquireFileLease(`grep-cursor:${file}`, {}, context.signal)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const directoryInfo = await lstat(directory)
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('Grep cursor directory is unsafe')
    await chmod(directory, 0o700)
    const cursors = await readPersistedGrepCursors(file)
    const result = update(cursors)
    if (result.changed) await writePersistedGrepCursors(file, cursors)
    return { available: true, value: result.value }
  } catch {
    context.signal?.throwIfAborted()
    return { available: false }
  } finally {
    if (lease) await lease.release().catch(() => {})
  }
}

async function issueGrepCursor(queryHash: string, matchSetHash: string, offset: number, context?: { sessionId?: string; signal?: AbortSignal }): Promise<{ cursor: string; persisted: boolean }> {
  const now = Date.now()
  const token = randomUUID()
  const state = { queryHash, matchSetHash, offset, expiresAt: now + GREP_CURSOR_TTL_MS }
  const persisted = await updatePersistedGrepCursors(context, cursors => {
    pruneGrepCursorMap(cursors, now)
    while (cursors.size >= MAX_GREP_CURSORS) {
      cursors.delete(cursors.keys().next().value!)
    }
    cursors.set(token, state)
    return { value: undefined, changed: true }
  })
  if (persisted.available) return { cursor: token, persisted: true }
  pruneGrepCursorMap(grepCursors, now)
  while (grepCursors.size >= MAX_GREP_CURSORS) grepCursors.delete(grepCursors.keys().next().value!)
  grepCursors.set(token, state)
  return { cursor: token, persisted: false }
}

async function takeGrepCursor(token: string, queryHash: string, context?: { sessionId?: string; signal?: AbortSignal }): Promise<GrepCursorLookup> {
  const now = Date.now()
  if (grepCursors.has(token)) {
    const state = grepCursors.get(token)!
    if (state.expiresAt <= now) { grepCursors.delete(token); return { kind: 'missing' } }
    if (state.queryHash !== queryHash) return { kind: 'query-mismatch' }
    grepCursors.delete(token)
    return { kind: 'found', state }
  }
  const persisted = await updatePersistedGrepCursors(context, cursors => {
    const changed = pruneGrepCursorMap(cursors, now)
    const state = cursors.get(token)
    if (!state) return { value: { kind: 'missing' } as GrepCursorLookup, changed }
    if (state.queryHash !== queryHash) return { value: { kind: 'query-mismatch' } as GrepCursorLookup, changed }
    cursors.delete(token)
    return { value: { kind: 'found', state } as GrepCursorLookup, changed: true }
  })
  return persisted.available ? persisted.value! : { kind: 'missing' }
}

/** Tool that regex-searches files, using native grep when it supports NUL-separated output and `jsGrep` otherwise. The search dir must pass `assertSafeDir`, and .deepseekignore matches are filtered out. */
export const Grep: Tool = {
  name: 'grep',
  description: `Search for one or several regex patterns in files using grep. Batch up to ${MAX_GREP_PATTERNS_PER_CALL} patterns per call; pass either pattern or patterns, not both. Pattern batches preserve successful results and return typed per-pattern failures. Results are grouped by file by default; set group_by to symbol to group supported files by the configured language server, with explicit file-level fallback when unavailable. Use the returned single-use cursor within ten minutes to continue the same session, query and matching-result snapshot; when private cursor storage is available it survives process restarts.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', minLength: 1, description: 'Regex pattern' },
      patterns: { type: 'array', minItems: 1, maxItems: MAX_GREP_PATTERNS_PER_CALL, items: { type: 'string', minLength: 1 }, description: `Up to ${MAX_GREP_PATTERNS_PER_CALL} regex patterns to search independently in one call; use instead of pattern` },
      path: { type: 'string', default: '.', description: 'Directory to search (default: .)' },
      include: { type: 'string', description: 'File glob filter, e.g. "*.ts"' },
      limit: { type: 'integer', minimum: 1, maximum: GREP_MAX_LINES, default: GREP_MAX_LINES, description: `Maximum matches per page (maximum ${GREP_MAX_LINES})` },
      group_by: { type: 'string', enum: ['file', 'symbol'], default: 'file', description: 'Group matches by file, or by enclosing symbol when a configured LSP supports the file.' },
      cursor: { type: 'string', description: 'Opaque single-use token returned by a previous grep page; valid for ten minutes before a process restart, in the same session, query, and matching-result snapshot' },
    },
    oneOf: [
      { required: ['pattern'], not: { required: ['patterns'] } },
      { required: ['patterns'], not: { required: ['pattern'] } },
    ],
    not: { required: ['patterns', 'cursor'] },
  },
  async execute(args, context) {
    if (args.pattern !== undefined && args.patterns !== undefined) return 'Error: grep cannot include both pattern and patterns'
    if (args.patterns !== undefined) {
      if (args.cursor !== undefined) return 'Error: continue one pattern at a time with its returned cursor'
      if (!Array.isArray(args.patterns) || !args.patterns.length) return 'Error: patterns must be a non-empty array of regex patterns'
      if (args.patterns.length > MAX_GREP_PATTERNS_PER_CALL) return `Error: patterns cannot exceed ${MAX_GREP_PATTERNS_PER_CALL} per call`
      if (!args.patterns.every(pattern => typeof pattern === 'string' && pattern.length > 0)) return 'Error: patterns must be a non-empty array of regex patterns'
      const results = await Promise.all(args.patterns.map(async pattern => ({
        pattern,
        result: normalizeToolResult(await Grep.execute({ ...args, pattern, patterns: undefined }, context)),
      })))
      const failures = results.filter(({ result }) => isToolErrorResult(result))
      if (failures.length) {
        const outcomes = results.map(({ pattern, result }) => isToolErrorResult(result)
          ? { pattern, status: 'error', result: JSON.parse(result) }
          : { pattern, status: 'done', output: result })
        return formatToolError('tool', failures.length === results.length ? 'GREP_PATTERNS_FAILED' : 'GREP_PATTERNS_PARTIAL',
          `${failures.length} of ${results.length} grep patterns failed.`, false, { results: outcomes })
      }
      return results.map(({ pattern, result }) => `### ${pattern}\n${result}`).join('\n\n')
    }
    if (typeof args.pattern !== 'string' || args.pattern.length === 0) return 'Error: pattern must be a non-empty regex string'
    const dir = await assertSafeDir((args.path as string) || '.', context)
    const pattern = args.pattern
    const include = args.include as string | undefined
    const limit = args.limit === undefined ? GREP_MAX_LINES : args.limit as number
    const groupBy = args.group_by === undefined ? 'file' : args.group_by
    if (args.offset !== undefined) return 'Error: offset continuation is no longer supported; use the cursor returned by grep'
    if (!Number.isInteger(limit) || limit < 1 || limit > GREP_MAX_LINES) return `Error: limit must be an integer from 1 to ${GREP_MAX_LINES}`
    if (groupBy !== 'file' && groupBy !== 'symbol') return 'Error: group_by must be file or symbol'
    const workspaceRoot = path.resolve(context?.workspacePath ?? process.cwd())
    const relativeScope = path.relative(workspaceRoot, dir)
    const scope = relativeScope && !escapesRoot(relativeScope) ? relativeScope : relativeScope ? dir : '.'
    const withScope = (result: string) => result.startsWith('Error: ')
      ? formatToolError('tool', 'GREP_FAILED', `${result.slice('Error: '.length)} (search scope: ${scope})`)
      : `Search scope: ${scope}\n${result}`
    const runtimeSettings = groupBy === 'symbol' ? context?.session?.runtimeSnapshot().settings : undefined
    const lspSettings = runtimeSettings?.lsp ?? null
    const queryHash = createHash('sha256').update(JSON.stringify({
      sessionId: context?.sessionId ?? null,
      workspaceRoot,
      dir,
      pattern,
      include: include ?? null,
      limit,
      groupBy,
      lspSettings,
      protectedPaths: [...(context?.protectedPaths ?? [])].map(value => path.resolve(value)).sort(),
    })).digest('hex')
    let cursorState: GrepCursorState | undefined
    if (args.cursor !== undefined) {
      if (typeof args.cursor !== 'string' || args.cursor.length > 128) return withScope('Error: invalid grep cursor')
      const lookup = await takeGrepCursor(args.cursor, queryHash, context)
      if (lookup.kind === 'missing') return withScope('Error: grep cursor is unknown or expired; restart the search')
      if (lookup.kind === 'query-mismatch') return withScope('Error: grep cursor does not match the original search query, scope, limit, or session')
      cursorState = lookup.state
    }
    const offset = cursorState?.offset ?? 0

    const grepArgs = ['-rnZ']
    if (include) grepArgs.push(`--include=${include}`)
    // GNU grep applies the last matching include/exclude rule.
    grepArgs.push(...SENSITIVE_GREP_EXCLUDE_ARGS)

    // Fast path: plain directory names from .deepseekignore (or defaults)
    // become --exclude-dir. Complex patterns are handled by the post-filter.
    for (const d of [...ignoreDirNames(workspaceRoot), '.DS_Store']) grepArgs.push(`--exclude-dir=${d}`)

    grepArgs.push('--', pattern, dir)

    const render = async (matches: GrepMatch[], totalMatches: number, matchSetHash: string) => {
      if (cursorState && cursorState.matchSetHash !== matchSetHash) {
        return withScope('Error: search results changed since this cursor; restart the search from the beginning')
      }
      const visible = matches.slice(0, limit)
      const nextOffset = offset + visible.length
      const symbolsByFile = new Map<string, { symbols: unknown[]; uri?: string }>()
      const unavailable = new Set<string>()
      if (groupBy === 'symbol') {
        const eligibleFiles = [...new Set(visible.map(match => match.file))].filter(file => runtimeSettings && findLspServer(runtimeSettings, file))
        const files = [...new Set(visible.map(match => match.file))]
        for (const file of files) if (!eligibleFiles.includes(file)) unavailable.add(file)
        // shortcut: cap symbol lookups at four files per page; raise only after measuring LSP latency.
        for (const file of eligibleFiles.slice(MAX_SYMBOL_FILES_PER_PAGE)) unavailable.add(file)
        await Promise.all(eligibleFiles.slice(0, MAX_SYMBOL_FILES_PER_PAGE).map(async file => {
          try {
            const raw = await Lsp.execute({ operation: 'document_symbols', path: file }, context)
            const response = JSON.parse(raw) as { result?: unknown; document?: { path?: string } }
            if (Array.isArray(response.result)) symbolsByFile.set(file, { symbols: response.result, uri: response.document?.path ? pathToFileURL(response.document.path).href : undefined })
            else unavailable.add(file)
          } catch {
            if (context?.signal?.aborted) throw context.signal.reason ?? new Error('Search cancelled')
            unavailable.add(file)
          }
        }))
      }
      const formatGroups = (useSymbols: boolean) => {
        const groups = new Map<string, Map<string, GrepMatch[]>>()
        for (const match of visible) {
          const fileGroups = groups.get(match.file) ?? new Map<string, GrepMatch[]>()
          const documentSymbols = symbolsByFile.get(match.file)
          const symbolPath = useSymbols && documentSymbols ? symbolPathForLine(documentSymbols.symbols, match.lineNumber, documentSymbols.uri) : undefined
          const label = useSymbols ? symbolPath ?? (documentSymbols ? '<no enclosing symbol>' : '<file-level fallback>') : ''
          const group = fileGroups.get(label) ?? []
          group.push(match)
          fileGroups.set(label, group)
          groups.set(match.file, fileGroups)
        }
        return [...groups].map(([file, fileGroups]) => {
          const matches = [...fileGroups].map(([symbol, fileMatches]) => {
            const heading = symbol ? `  ${symbol}\n` : ''
            const indent = symbol ? '    ' : '  '
            return `${heading}${fileMatches.map(match => `${indent}${match.lineNumber}:${match.text}`).join('\n')}`
          }).join('\n')
          return `${file}\n${matches}`
        }).join('\n\n')
      }
      let result = formatGroups(groupBy === 'symbol')
      if (groupBy === 'symbol' && Buffer.byteLength(result, 'utf8') > GREP_MAX_RESULT_BYTES) {
        for (const file of symbolsByFile.keys()) unavailable.add(file)
        result = formatGroups(false)
      }
      const fallbackNote = unavailable.size
        ? `\n\nSymbol grouping fell back to file-level output for ${unavailable.size} file${unavailable.size === 1 ? '' : 's'} (no configured server, lookup failure, or output/page budget).`
        : ''
      if (totalMatches > nextOffset) {
        const issued = await issueGrepCursor(queryHash, matchSetHash, nextOffset, context)
        const persistenceNote = issued.persisted ? '' : ' Private cursor storage was unavailable, so this cursor lasts only until this process exits.'
        return withScope(`${result}${fallbackNote}\n\nShowing ${offset + 1}–${nextOffset} of ${totalMatches} matches. Snapshot: ${matchSetHash.slice(0, 16)}. Continue with grep cursor=${issued.cursor} and limit=${limit}; it expires after ten minutes.${persistenceNote}`)
      }
      return withScope(`${result || (offset ? `No matches at cursor position ${offset}; ${totalMatches} total matches.` : 'No matches')}${fallbackNote}`)
    }

    const runJsFallback = async () => {
      const { matches, totalMatches, matchSetHash, error } = await jsGrep({
        dir,
        pattern,
        include,
        workspaceRoot,
        ignoreDirs: [...ignoreDirNames(workspaceRoot), '.DS_Store'],
        limit,
        offset,
        signal: context?.signal,
        exclude: file => isProtectedPath(file, context),
      })
      if (error) return withScope(`Error: ${error}`)
      if (!matchSetHash) return withScope('Error: search was interrupted; restart the search')
      return render(matches, totalMatches ?? matches.length, matchSetHash)
    }

    // Native grep is used only when its NUL filename separator is known to work.
    // Filter before reading, not after a native subprocess has consumed private state.
    if (context?.protectedPaths?.length || !(await supportsNativeGrep())) return runJsFallback()

    try {
      const subprocess = execa('grep', grepArgs, {
        timeout: 15000,
        cancelSignal: context?.signal,
        buffer: { stdout: false },
        maxBuffer: { stderr: 16_384 },
      })
      const pagePromise = readNativeGrepPage(subprocess.iterable({ binary: true }), workspaceRoot, offset, limit)
      try {
        await subprocess
      } catch (err: unknown) {
        const page = await pagePromise
        const exitCode = (err as { exitCode?: number })?.exitCode
        if (exitCode === 1) return render(page.matches, page.totalMatches, page.matchSetHash)
        if (unsupportedGrepOptions(err)) return runJsFallback()
        const msg = (err as { stderr?: string })?.stderr || 'Grep failed'
        return withScope(`Error: ${msg}`)
      }
      const page = await pagePromise
      return render(page.matches, page.totalMatches, page.matchSetHash)
    } catch (err: unknown) {
      const msg = (err as { stderr?: string })?.stderr || 'Grep failed'
      return withScope(`Error: ${msg}`)
    }
  },
}
