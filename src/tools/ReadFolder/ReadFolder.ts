import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { assertSafeDir, isProtectedPath } from '../shared/pathSafety.js'
import type { ToolExecutionContext } from '../../orchestration/types.js'
import { isPathIgnored } from '../shared/deepseekignore.js'
import { formatToolError } from '../result.js'
import { safeGraphemeEnd, safeGraphemeStart } from '../../utils/textBoundaries.js'

const MAX_ENTRIES = 1000
const DEFAULT_MAX_DEPTH = 5
const MAX_PATHS = 32
const MAX_PATH_BYTES = 4096
const MAX_PATH_PAYLOAD_BYTES = 65_536
const MAX_PARTIAL_CHARS = 20_000

type MultiDirectoryResult = { dir: string; result: string } | { dir: string; error: string }

interface ListDirState {
  results: string[]
  truncated: boolean
  unreadableDirectories: string[]
  rootReadError?: string
  /** Workspace root whose .deepseekignore governs this listing. */
  ignoreRoot: string
  context?: ToolExecutionContext
}

function recursivePermissionPartialResult(header: string, listing: string, unreadableDirectories: string[], entriesTruncated: boolean): string {
  const outputTruncationNote = '\n[Listing shortened to fit the response limit; use a narrower path to recover omitted entries.]'
  const entryTruncationNote = entriesTruncated
    ? `\n\n[Truncated: exceeded ${MAX_ENTRIES} entries. Use a more specific path.]`
    : ''
  const message = `${unreadableDirectories.length} descendant directories could not be read due to permissions.`
  const envelope = (output: string, directories: string[], outputTruncated: boolean) => formatToolError(
    'tool', 'READ_FOLDER_PARTIAL', message, false,
    {
      output,
      unreadableDirectories: directories,
      omittedUnreadableDirectories: unreadableDirectories.length - directories.length,
      entriesTruncated,
      outputTruncated,
    },
  )
  const outputFor = (end: number, outputTruncated: boolean) =>
    `${header}${listing.slice(0, end)}${entryTruncationNote}${outputTruncated ? outputTruncationNote : ''}`

  const minimumListingEnd = safeGraphemeEnd(listing, Math.min(listing.length, 512))
  const minimumTruncated = minimumListingEnd < listing.length
  const minimumOutput = outputFor(minimumListingEnd, minimumTruncated)
  let lowDirectories = 0
  let highDirectories = unreadableDirectories.length
  let visibleDirectoryCount = 0
  while (lowDirectories <= highDirectories) {
    const candidateCount = Math.floor((lowDirectories + highDirectories) / 2)
    if (envelope(minimumOutput, unreadableDirectories.slice(0, candidateCount), minimumTruncated).length <= MAX_PARTIAL_CHARS) {
      visibleDirectoryCount = candidateCount
      lowDirectories = candidateCount + 1
    } else highDirectories = candidateCount - 1
  }

  const visibleDirectories = unreadableDirectories.slice(0, visibleDirectoryCount)
  let low = minimumListingEnd
  let high = listing.length
  let listingEnd = minimumListingEnd
  while (low <= high) {
    const candidateEnd = Math.floor((low + high) / 2)
    const safeEnd = safeGraphemeEnd(listing, candidateEnd)
    const truncated = safeEnd < listing.length
    const output = outputFor(safeEnd, truncated)
    if (envelope(output, visibleDirectories, truncated).length <= MAX_PARTIAL_CHARS) {
      listingEnd = safeEnd
      low = candidateEnd + 1
    } else high = candidateEnd - 1
  }

  const outputTruncated = listingEnd < listing.length
  const output = outputFor(listingEnd, outputTruncated)
  return envelope(output, visibleDirectories, outputTruncated)
}

function readFolderFailure(result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as {
      schemaVersion?: unknown
      status?: unknown
      error?: { code?: unknown; message?: unknown }
    }
    if (parsed.schemaVersion === 1 && parsed.status === 'error' && parsed.error?.code === 'READ_FOLDER_FAILED') {
      return typeof parsed.error.message === 'string' ? parsed.error.message : 'Directory could not be read'
    }
  } catch { /* Ordinary listings are text, not JSON. */ }
  return undefined
}

/** Depth-limited walk that appends entries to `state.results`, skips .deepseekignore matches, and records unreadable descendant paths. Stops once MAX_ENTRIES is reached. */
async function listDir(
  dir: string,
  recursive: boolean,
  prefix: string,
  depth: number,
  state: ListDirState,
): Promise<void> {
  if (state.truncated) return

  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (e) {
    // Gracefully handle permission errors — skip unreadable dirs
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      if (prefix) state.unreadableDirectories.push(prefix)
      else state.rootReadError = code
      return
    }
    throw e
  }

  for (const e of entries) {
    if (state.truncated) return
    if (isPathIgnored(path.join(dir, e.name), state.ignoreRoot)) continue
    if (await isProtectedPath(path.join(dir, e.name), state.context)) continue

    const rel = prefix ? `${prefix}/${e.name}` : e.name
    state.results.push(e.isDirectory() ? `${rel}/` : rel)

    if (state.results.length >= MAX_ENTRIES) {
      state.truncated = true
      return
    }

    if (e.isDirectory() && recursive && depth > 0) {
      await listDir(path.join(dir, e.name), true, rel, depth - 1, state)
    }
  }
}

/** Read-only tool listing a directory, optionally recursive up to 5 levels and 1000 entries. The dir must pass `assertSafeDir`. */
export const ReadFolder: Tool = {
  name: 'read_folder',
  description: `List one directory or up to ${MAX_PATHS} directories. Mixed multi-directory results use a typed partial-error envelope capped at ${MAX_PARTIAL_CHARS} characters; each failure detail is capped at 80 UTF-16 code units.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES, pattern: '\\S', description: 'Directory path' },
      paths: { type: 'array', minItems: 1, maxItems: MAX_PATHS, items: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES, pattern: '\\S' }, description: 'Up to 32 directory paths to list independently in one call; use instead of path' },
      recursive: { type: 'boolean', default: false, description: 'Recurse into subdirs (default: false)' },
    },
    oneOf: [{ required: ['path'] }, { required: ['paths'] }],
  },
  async execute(args, context) {
    context?.signal?.throwIfAborted()
    if (args.path !== undefined && args.paths !== undefined) {
      return formatToolError('validation', 'INVALID_ARGUMENTS', 'read_folder cannot include both path and paths')
    }
    if (args.paths !== undefined) {
      if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > MAX_PATHS || !args.paths.every(dir => typeof dir === 'string' && dir.trim())) {
        return `Error: paths must contain between 1 and ${MAX_PATHS} non-empty directory paths`
      }
      if (args.paths.some(dir => Buffer.byteLength(dir, 'utf8') > MAX_PATH_BYTES)) return `Error: each directory path must be at most ${MAX_PATH_BYTES} UTF-8 bytes`
      if (Buffer.byteLength(JSON.stringify(args.paths), 'utf8') > MAX_PATH_PAYLOAD_BYTES) return `Error: combined directory paths exceed ${MAX_PATH_PAYLOAD_BYTES} UTF-8 bytes`

      const results: MultiDirectoryResult[] = await Promise.all(args.paths.map(async dir => {
        try {
          const result = await ReadFolder.execute({ ...args, path: dir, paths: undefined }, context)
          const failure = readFolderFailure(result)
          return failure ? { dir, error: failure } : { dir, result }
        }
        catch (error) {
          if (context?.signal?.aborted) throw context.signal.reason ?? error
          return { dir, error: error instanceof Error ? error.message : String(error) }
        }
      }))
      const failures = results.filter((result): result is { dir: string; error: string } => 'error' in result)
      const successes = results.filter((result): result is { dir: string; result: string } => 'result' in result)
      if (!failures.length) return successes.map(({ dir, result }) => `### ${dir}\n${result}`).join('\n\n')

      // shortcut: per-path failure details are capped at 80 UTF-16 code units; raise only with a larger response cap.
      const failureDetails = failures.map(({ dir, error }) => {
        const detail = `${dir}: ${error}`
        return detail.length <= 80 ? detail
          : `${detail.slice(0, safeGraphemeEnd(detail, 48))}…${detail.slice(safeGraphemeStart(detail, detail.length - 30))}`
      })
      if (failures.length === results.length) {
        return formatToolError('tool', 'READ_FOLDER_FAILED', `All ${results.length} requested directories failed:\n${failureDetails.join('\n')}`)
      }

      const output = successes.map(({ dir, result }) => `### ${dir}\n${result}`).join('\n\n')
      const envelope = (partial: string, shortened: boolean) => formatToolError(
        'tool', 'READ_FOLDER_PARTIAL', `${failures.length} of ${results.length} requested directories could not be read.${shortened ? ' Some listing output was shortened to fit the response limit.' : ''}`,
        false, { output: partial, failures: failureDetails },
      )
      const complete = envelope(output, false)
      if (complete.length <= MAX_PARTIAL_CHARS) return complete

      let low = 0, high = output.length
      let partial = ''
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidate = output.slice(0, safeGraphemeEnd(output, middle))
        if (envelope(candidate, true).length <= MAX_PARTIAL_CHARS) {
          partial = candidate
          low = middle + 1
        } else high = middle - 1
      }
      return envelope(partial, true)
    }
    if (typeof args.path !== 'string' || !args.path.trim()) return 'Error: path is required'
    if (Buffer.byteLength(args.path, 'utf8') > MAX_PATH_BYTES) return `Error: path exceeds ${MAX_PATH_BYTES} UTF-8 bytes`
    const dirPath = await assertSafeDir(args.path as string, context)
    const ignoreRoot = path.resolve(context?.workspacePath ?? process.cwd())

    const state: ListDirState = { results: [], truncated: false, unreadableDirectories: [], ignoreRoot, context }
    await listDir(dirPath, !!args.recursive, '', DEFAULT_MAX_DEPTH, state)
    if (state.rootReadError) {
      return formatToolError('tool', 'READ_FOLDER_FAILED', `Directory '${args.path}' could not be read due to permissions (${state.rootReadError}).`)
    }
    const relativeScope = path.relative(ignoreRoot, dirPath)
    const scope = relativeScope === ''
      ? '.'
      : !path.isAbsolute(relativeScope) && relativeScope !== '..' && !relativeScope.startsWith(`..${path.sep}`)
        ? relativeScope
        : dirPath
    const header = `Directory scope: ${scope}\nRecursion: ${args.recursive ? `enabled (max depth ${DEFAULT_MAX_DEPTH})` : 'disabled'}\n`
    const listing = state.results.join('\n') || (state.unreadableDirectories.length ? '' : '(empty directory)')
    const output = header + listing + (state.truncated ? `\n\n[Truncated: exceeded ${MAX_ENTRIES} entries. Use a more specific path.]` : '')

    if (state.unreadableDirectories.length) {
      return recursivePermissionPartialResult(header, listing, state.unreadableDirectories, state.truncated)
    }

    if (state.truncated) {
      return output
    }

    return output
  },
}
