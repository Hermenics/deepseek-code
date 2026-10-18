import { Tool } from '../types.js'
import * as fs from 'fs/promises'
import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { TextDecoder } from 'node:util'
import type { FileVersion } from '../../orchestration/types.js'
import { acquireFileLease } from '../../orchestration/fileLease.js'
import { assertSafePath, hashFileContent } from '../shared/pathSafety.js'
import { safeGraphemeEnd, safeGraphemeStart } from '../../utils/textBoundaries.js'
import { formatToolError } from '../result.js'

const DEFAULT_MAX_LINES = 500
export const READ_FILE_RESPONSE_CHAR_LIMIT = 20_000
export const READ_FILE_CAPTURE_BYTE_LIMIT = 1_000_000
const MAX_IN_MEMORY_FILE_BYTES = 64_000
const MAX_WHOLE_FILE_FINGERPRINT_BYTES = 256 * 1024 * 1024
const FINGERPRINT_LIMIT_MESSAGE = `file exceeds the ${MAX_WHOLE_FILE_FINGERPRINT_BYTES} byte whole-file fingerprint limit`
const MAX_BYTE_SLICE = 16_000
const MAX_PATHS_PER_CALL = 32
const MAX_PATH_BYTES = 4_096
const MAX_TOTAL_PATH_BYTES = 65_536

function fileIdentity(info: BigIntStats): string {
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].join(':')
}

function throwIfReadCancelled(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) signal.throwIfAborted()
  if (error instanceof Error && (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')) throw error
}

async function inspectUtf8File(filePath: string, startByte: number, endByte: number, signal?: AbortSignal): Promise<{
  hash: string; binary: boolean; identity: string; size: bigint; startBoundary: boolean; safeEndByte: number; boundaryValidationLimited: boolean
}> {
  // This scan validates UTF-8 and binds the whole-file hash to the identity used by subsequent range reads.
  const before = await fs.stat(filePath, { bigint: true })
  if (before.size > BigInt(MAX_WHOLE_FILE_FINGERPRINT_BYTES)) throw new RangeError('File hash byte limit exceeded')
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let binary = false
  let graphemeTail = ''
  let graphemeTailByte = 0
  let startBoundary = startByte === 0
  let safeEndByte = 0
  let boundaryScanDone = false
  let boundaryValidationLimited = false
  const recordBoundary = (byteOffset: number) => {
    if (byteOffset === startByte) startBoundary = true
    if (byteOffset <= endByte && byteOffset > safeEndByte) safeEndByte = byteOffset
  }
  const segmentText = (text: string, final = false) => {
    if (boundaryScanDone) return
    const combined = graphemeTail + text
    const iterator = segmenter.segment(combined)[Symbol.iterator]()
    let previous = iterator.next()
    if (previous.done) return
    let completedBytes = 0
    let next = iterator.next()
    while (!next.done) {
      completedBytes += Buffer.byteLength(previous.value.segment, 'utf8')
      const boundary = graphemeTailByte + completedBytes
      recordBoundary(boundary)
      if (boundary > endByte || (!startBoundary && boundary > startByte)) {
        boundaryScanDone = true
        graphemeTail = ''
        return
      }
      previous = next
      next = iterator.next()
    }
    if (final) {
      completedBytes += Buffer.byteLength(previous.value.segment, 'utf8')
      const boundary = graphemeTailByte + completedBytes
      recordBoundary(boundary)
      if (boundary > endByte || (!startBoundary && boundary > startByte)) boundaryScanDone = true
      graphemeTail = ''
    } else {
      const pendingStartByte = graphemeTailByte + completedBytes
      const pendingBytes = Buffer.byteLength(previous.value.segment, 'utf8')
      const pendingEndByte = pendingStartByte + pendingBytes
      if ((!startBoundary && pendingEndByte > startByte) || pendingEndByte > endByte) {
        boundaryScanDone = true
        graphemeTail = ''
        return
      }
      if (pendingBytes > MAX_BYTE_SLICE) {
        // shortcut: refuse an unbounded grapheme look-behind; raise only with a bounded streaming segmenter.
        boundaryScanDone = true
        boundaryValidationLimited = true
        graphemeTail = ''
        return
      }
      graphemeTail = combined.slice(previous.value.index)
      graphemeTailByte = pendingStartByte
    }
  }
  const onChunk = (chunk: Buffer) => {
    if (chunk.includes(0)) binary = true
    segmentText(decoder.decode(chunk, { stream: true }))
  }
  const hash = await hashFileContent(filePath, onChunk, signal, MAX_WHOLE_FILE_FINGERPRINT_BYTES)
  segmentText(decoder.decode(), true)
  const after = await fs.stat(filePath, { bigint: true })
  if (fileIdentity(before) !== fileIdentity(after)) throw new Error('file changed while reading; retry')
  recordBoundary(Number(after.size))
  return { hash, binary, identity: fileIdentity(after), size: after.size, startBoundary, safeEndByte, boundaryValidationLimited }
}

/** Read-only tool returning a bounded, line-numbered file slice. The path must pass `assertSafePath`. */
export const ReadFile: Tool = {
  name: 'read_file',
  description: `Read one or several files with line numbers. Pass path for one file or paths for several files in one call. Use it instead of shell cat/sed/head.
- A call can include at most 32 paths, each up to 4096 UTF-8 bytes, with a combined serialized path payload of at most 65536 bytes; pass either path or paths, not both
- Without start_line/end_line/start_char/start_byte: returns up to ${DEFAULT_MAX_LINES} lines
- With start_line and/or end_line: starts at that 1-indexed line; response is always capped at ${READ_FILE_RESPONSE_CHAR_LIMIT} characters for the entire call
- If output says it was truncated at start_char=N, continue that file with start_char=N (UTF-16 code-unit offset in the decoded file); start_char cannot be combined with line ranges
- Large files use bounded UTF-8 byte slices that start and end at Unicode grapheme boundaries; a cluster that cannot fit the slice or be validated within bounded context is refused. Continue with start_byte=N from the returned range. start_byte cannot be combined with line ranges or start_char
- Byte-range reads require a whole-file fingerprint and refuse files larger than ${MAX_WHOLE_FILE_FINGERPRINT_BYTES} bytes
- Captured file bytes are capped at ${READ_FILE_CAPTURE_BYTE_LIMIT} per call; each response is capped at ${READ_FILE_RESPONSE_CHAR_LIMIT} characters
- A multi-file read that mixes successes and failures returns a typed partial-error envelope with the readable output and bounded failure details
- Read large files in chunks; read a file before editing it`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES, description: 'One file path; cannot be combined with paths' },
      paths: { type: 'array', minItems: 1, maxItems: MAX_PATHS_PER_CALL, items: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES }, description: 'Up to 32 file paths to read together; use instead of path' },
      start_line: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'First line to read (1-indexed, inclusive). Defaults to 1.' },
      end_line: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Last line to read (1-indexed, inclusive). Defaults to start_line + 499.' },
      start_char: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'UTF-16 code-unit offset in the decoded file from which to continue after a response-budget truncation; cannot be combined with start_line or end_line.' },
      start_byte: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'UTF-8 byte offset at a Unicode grapheme boundary for continuing a large-file slice; cannot be combined with line ranges or start_char.' },
    },
    allOf: [
      {
        if: { not: { anyOf: [{ required: ['start_char'] }, { required: ['start_byte'] }] } },
        then: { properties: { start_line: { default: 1 } } },
      },
      { not: { required: ['start_char'], anyOf: [{ required: ['start_line'] }, { required: ['end_line'] }] } },
      { not: { required: ['start_byte'], anyOf: [{ required: ['start_char'] }, { required: ['start_line'] }, { required: ['end_line'] }] } },
    ],
    oneOf: [
      { required: ['path'], not: { required: ['paths'] } },
      { required: ['paths'], not: { required: ['path'] } },
    ],
  },
  async execute(args, context) {
    const paths = args.paths
    if (paths !== undefined && args.path !== undefined) return 'Error: read_file cannot include both path and paths'
    if (paths !== undefined && (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS_PER_CALL || !paths.every(path => typeof path === 'string' && path.trim()))) {
      return `Error: paths must contain between 1 and ${MAX_PATHS_PER_CALL} non-empty file paths`
    }
    if (args.start_char !== undefined && (args.start_line !== undefined || args.end_line !== undefined)) return 'Error: start_char cannot be combined with line ranges'
    if (args.start_byte !== undefined && (args.start_char !== undefined || args.start_line !== undefined || args.end_line !== undefined)) return 'Error: start_byte cannot be combined with start_char or line ranges'
    if (args.start_char !== undefined && (!Number.isSafeInteger(args.start_char) || (args.start_char as number) < 0)) return 'Error: start_char must be a non-negative safe integer'
    if (args.start_byte !== undefined && (!Number.isSafeInteger(args.start_byte) || (args.start_byte as number) < 0)) return 'Error: start_byte must be a non-negative safe integer'
    if (args.start_line !== undefined && (!Number.isSafeInteger(args.start_line) || (args.start_line as number) < 1)) return 'Error: start_line must be a positive safe integer'
    if (args.end_line !== undefined && (!Number.isSafeInteger(args.end_line) || (args.end_line as number) < 1)) return 'Error: end_line must be a positive safe integer'
    if (args.end_line !== undefined && (args.end_line as number) < (args.start_line as number | undefined ?? 1)) return 'Error: end_line must be greater than or equal to start_line'

    const filePaths = paths as string[] | undefined ?? [args.path as string]
    if (!paths && (typeof args.path !== 'string' || !args.path.trim())) return 'Error: path is required'
    for (const path of filePaths) {
      const pathBytes = Buffer.byteLength(path, 'utf8')
      if (pathBytes > MAX_PATH_BYTES) return `Error: path exceeds ${MAX_PATH_BYTES} UTF-8 bytes`
    }
    const pathPayload = paths === undefined ? { path: filePaths[0] } : { paths: filePaths }
    if (Buffer.byteLength(JSON.stringify(pathPayload), 'utf8') > MAX_TOTAL_PATH_BYTES) return `Error: combined paths exceed ${MAX_TOTAL_PATH_BYTES} UTF-8 bytes`
    const results: string[] = []
    let remaining = READ_FILE_RESPONSE_CHAR_LIMIT
    let remainingBytes = READ_FILE_CAPTURE_BYTE_LIMIT
    let attemptedPaths = 0
    let failedPaths = 0
    const failureDetails: string[] = []
    for (let i = 0; i < filePaths.length; i++) {
      context?.signal?.throwIfAborted()
      if (remaining <= 0) break
      if (remainingBytes === 0) {
        const separator = results.length ? '\n\n' : ''
        const note = '[byte capture limit reached; remaining files omitted]'
        results.push(separator + note.slice(0, Math.max(0, remaining - separator.length)))
        break
      }
      let result: Awaited<ReturnType<typeof readOne>>
      try { result = await readOne(filePaths[i]!, args, context, remaining, remainingBytes) }
      catch (error) {
        throwIfReadCancelled(error, context?.signal)
        const message = error instanceof Error ? error.message : String(error)
        result = { output: `Error: could not read ${filePaths[i]}: ${message}`, filePath: filePaths[i]! }
      }
      context?.signal?.throwIfAborted()
      attemptedPaths++
      if (result.output.startsWith('Error:')) {
        failedPaths++
        failureDetails.push(result.output.length <= 80 ? result.output
          : `${result.output.slice(0, safeGraphemeEnd(result.output, 48))}…${result.output.slice(safeGraphemeStart(result.output, result.output.length - 30))}`)
      }
      const separator = results.length ? '\n\n' : ''
      if (result.output.length + separator.length > remaining) {
        const note = `\n[response limit reached; remaining files omitted]`
        results.push(separator + note.slice(0, Math.max(0, remaining - separator.length)))
        break
      }
      results.push(separator + result.output)
      if (result.version) context?.onFileReadReturned?.(result.filePath, result.version)
      remaining -= result.output.length + separator.length
      remainingBytes -= result.bytesCaptured ?? 0
    }
    const output = results.join('')
    const bounded = output.slice(0, safeGraphemeEnd(output, READ_FILE_RESPONSE_CHAR_LIMIT))
    if (failedPaths > 0 && failedPaths < attemptedPaths) {
      const message = `${failedPaths} of ${attemptedPaths} attempted files could not be read.`
      const envelope = (partial: string, shortened: boolean) => formatToolError(
        'tool', 'READ_FILE_PARTIAL', `${message}${shortened ? ' Partial output was shortened to fit the response limit.' : ''}`, false,
        { output: partial, failures: failureDetails },
      )
      const complete = envelope(bounded, false)
      if (complete.length <= READ_FILE_RESPONSE_CHAR_LIMIT) return complete

      let low = 0, high = bounded.length
      let partial = ''
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidate = bounded.slice(0, safeGraphemeEnd(bounded, middle))
        if (envelope(candidate, true).length <= READ_FILE_RESPONSE_CHAR_LIMIT) {
          partial = candidate
          low = middle + 1
        } else high = middle - 1
      }
      return envelope(partial, true)
    }
    return bounded
  },
}

async function readOne(path: string, args: Record<string, unknown>, context: Parameters<Tool['execute']>[1], budget: number, byteBudget: number): Promise<{ output: string; filePath: string; version?: FileVersion; bytesCaptured?: number }> {
  const filePath = await assertSafePath(path, context)
  const lease = await acquireFileLease(`file:${filePath}`, { sessionId: context?.sessionId, taskId: context?.taskId }, context?.signal)
  try {
    if (await assertSafePath(path, context) !== filePath) return { output: `Error: read target changed during authorization: ${filePath}`, filePath }
    let info: Awaited<ReturnType<typeof fs.stat>>
    try { info = await fs.stat(filePath) }
    catch (error) {
      throwIfReadCancelled(error, context?.signal)
      const e = error as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return { output: `Error: file not found: ${filePath}`, filePath, version: { exists: false, hash: createHash('sha256').update('').digest('hex') } }
      if (e.code === 'EACCES') return { output: `Error: permission denied: ${filePath}`, filePath }
      return { output: `Error: could not read ${filePath}: ${e.message}`, filePath }
    }

    const startByte = args.start_byte as number | undefined
    const hasLineRange = args.start_line !== undefined || args.end_line !== undefined
    const useByteSlice = startByte !== undefined || info.size > Math.min(MAX_IN_MEMORY_FILE_BYTES, byteBudget)
    if (useByteSlice) {
      if (info.size > MAX_WHOLE_FILE_FINGERPRINT_BYTES) return { output: `Error: file exceeds the ${MAX_WHOLE_FILE_FINGERPRINT_BYTES} byte whole-file fingerprint limit; use a tool designed to process larger files`, filePath }
      if (hasLineRange || args.start_char !== undefined) return { output: `Error: ${filePath} exceeds the in-memory read limit; use start_byte ranges without line ranges`, filePath }
      const offset = startByte ?? 0
      if (offset > info.size) return { output: `Error: start_byte exceeds file size (${info.size})`, filePath }
      if (byteBudget < 4) return { output: 'Error: remaining byte budget is too small for a UTF-8 slice; read this path separately', filePath }

      const headerStart = `[${filePath}  ${info.size} bytes total  showing bytes ${offset}–${info.size}]\n`
      const maxBytes = Math.min(MAX_BYTE_SLICE, byteBudget, Math.max(0, budget - headerStart.length - 100))
      if (maxBytes < 1) return { output: `${headerStart}[not enough response space; read this path separately]`, filePath }
      let inspected: Awaited<ReturnType<typeof inspectUtf8File>>
      try { inspected = await inspectUtf8File(filePath, offset, offset + maxBytes, context?.signal) }
      catch (error) {
        throwIfReadCancelled(error, context?.signal)
        if (error instanceof TypeError) return { output: `Error: ${filePath} is not valid UTF-8`, filePath }
        const e = error as NodeJS.ErrnoException
        if (e.code === 'ENOENT') return { output: `Error: file changed while reading: ${filePath}; retry`, filePath }
        if (error instanceof Error && error.message.startsWith('file changed while reading')) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath }
        if (error instanceof RangeError && error.message === 'File hash byte limit exceeded') return { output: `Error: ${FINGERPRINT_LIMIT_MESSAGE}; use a tool designed to process larger files`, filePath }
        if (e.code === 'EACCES') return { output: `Error: permission denied: ${filePath}`, filePath }
        return { output: `Error: could not read ${filePath}: ${e.message}`, filePath }
      }
      if (inspected.binary) return { output: `Error: ${filePath} appears to be a binary file`, filePath }
      if (inspected.size !== BigInt(info.size)) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath }
      if (inspected.boundaryValidationLimited) return { output: 'Error: a Unicode grapheme cluster exceeds the bounded byte-range context; use a tool designed to process this file', filePath }

      const handle = await fs.open(filePath, 'r')
      let bytesRead = 0
      let selected: Buffer
      let handleAfterIdentity: string | undefined
      try {
        if (fileIdentity(await handle.stat({ bigint: true })) !== inspected.identity) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath }
        if (offset < info.size) {
          const firstByte = Buffer.alloc(1)
          await handle.read(firstByte, 0, 1, offset)
          if ((firstByte[0]! & 0xc0) === 0x80) return { output: `Error: start_byte=${offset} splits a UTF-8 character; continue from a returned next_byte boundary`, filePath }
        }
        if (!inspected.startBoundary) return { output: `Error: start_byte=${offset} splits a Unicode grapheme cluster; continue from a returned next_byte boundary`, filePath }
        const selectedLength = inspected.safeEndByte - offset
        if (selectedLength <= 0 && offset < info.size) return { output: 'Error: byte budget cannot fit one complete Unicode grapheme cluster; read this path separately', filePath }
        const buffer = Buffer.alloc(selectedLength)
        bytesRead = (await handle.read(buffer, 0, selectedLength, offset)).bytesRead
        if (bytesRead !== selectedLength) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath, bytesCaptured: bytesRead }
        selected = buffer.subarray(0, bytesRead)
        handleAfterIdentity = fileIdentity(await handle.stat({ bigint: true }))
      } finally {
        await handle.close()
      }
      const endByte = offset + selected.length
      const after = await fs.stat(filePath, { bigint: true }).catch(() => undefined)
      if (!after || Number(after.size) !== info.size || fileIdentity(after) !== inspected.identity || handleAfterIdentity !== inspected.identity) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath, bytesCaptured: bytesRead }
      const header = `[${filePath}  ${info.size} bytes total  showing bytes ${offset}–${endByte}]\n`
      let body: string
      try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(selected) }
      catch { return { output: `Error: file changed while reading: ${filePath}; retry`, filePath, bytesCaptured: bytesRead } }
      const continuation = endByte < info.size ? `\n[continue with start_byte=${endByte}]` : '\n[end of file]'
      return { output: `${header}${body}${continuation}`, filePath, version: { exists: true, hash: inspected.hash }, bytesCaptured: bytesRead }
    }

    let bytes: Buffer
    try {
      const handle = await fs.open(filePath, 'r')
      try {
        bytes = Buffer.alloc(info.size)
        let totalRead = 0
        while (totalRead < info.size) {
          const result = await handle.read(bytes, totalRead, info.size - totalRead, totalRead)
          if (!result.bytesRead) break
          totalRead += result.bytesRead
        }
        if (totalRead !== info.size) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath }
      } finally {
        await handle.close()
      }
    } catch (error) {
      throwIfReadCancelled(error, context?.signal)
      const e = error as NodeJS.ErrnoException
      if (e.code === 'EACCES') return { output: `Error: permission denied: ${filePath}`, filePath }
      return { output: `Error: could not read ${filePath}: ${e.message}`, filePath }
    }
    let content: string
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { return { output: `Error: ${filePath} is not valid UTF-8`, filePath } }
    if (bytes.includes(0)) return { output: `Error: ${filePath} appears to be a binary file`, filePath }
    const after = await fs.stat(filePath).catch(() => undefined)
    if (!after || after.size !== info.size || after.mtimeMs !== info.mtimeMs) return { output: `Error: file changed while reading: ${filePath}; retry`, filePath }
    const version: FileVersion = { exists: true, hash: createHash('sha256').update(bytes).digest('hex') }
    const bytesCaptured = bytes.length
    const allLines = content.split('\n')
    const total = allLines.length
    const startLine = args.start_line as number | undefined ?? 1
    const endLine = args.end_line as number | undefined ?? Math.min(startLine + DEFAULT_MAX_LINES - 1, total)
    const startChar = args.start_char as number | undefined
    if (startChar !== undefined && startChar > content.length) return { output: `Error: start_char exceeds file length (${content.length})`, filePath }
    if (startChar !== undefined && safeGraphemeStart(content, startChar) !== startChar) return { output: 'Error: start_char splits a Unicode grapheme cluster', filePath }
    const start0 = startChar === undefined ? startLine - 1 : content.slice(0, startChar).split('\n').length - 1
    const effectiveStart = Math.min(Math.max(0, start0), total)
    const effectiveEnd = Math.min(startChar === undefined ? endLine : effectiveStart + DEFAULT_MAX_LINES, total)
    const width = String(effectiveEnd).length
    const header = `[${filePath}  ${total} lines total  showing ${effectiveStart + 1}–${effectiveEnd}]\n`
    const firstPrefix = `${String(effectiveStart + 1).padStart(width, ' ')}  `
    if (budget <= header.length + firstPrefix.length + 102) return { output: `${header}[not enough response space; read this path separately]`, filePath }

    let output = header
    let sourceOffset = allLines.slice(0, effectiveStart).join('\n').length + (effectiveStart ? 1 : 0)
    for (let lineIndex = effectiveStart; lineIndex < effectiveEnd; lineIndex++) {
      const lineStart = sourceOffset
      const line = allLines[lineIndex]!
      const lineOffset = startChar !== undefined && lineIndex === effectiveStart ? startChar - lineStart : 0
      const rowPrefix = `${String(lineIndex + 1).padStart(width, ' ')}  `
      const rest = line.slice(Math.max(0, lineOffset))
      const newline = lineIndex < effectiveEnd - 1 ? '\n' : ''
      const available = budget - output.length - rowPrefix.length - newline.length - 100
      if (available < rest.length) {
        const shown = rest.slice(0, safeGraphemeEnd(rest, Math.max(0, available)))
        const nextOffset = lineStart + lineOffset + shown.length
        const marker = `\n[truncated at start_char=${nextOffset}; continue with start_char=${nextOffset}]`
        const truncated = output + rowPrefix + shown + marker
        return { output: truncated.slice(0, safeGraphemeEnd(truncated, budget)), filePath, version, bytesCaptured }
      }
      output += rowPrefix + rest + newline
      sourceOffset = lineStart + line.length + (lineIndex < total - 1 ? 1 : 0)
    }
    const hasMoreLines = effectiveEnd < total
    if (hasMoreLines) output += `${output.endsWith('\n') ? '' : '\n'}[line range ended; continue with start_line=${effectiveEnd + 1}]`
    return { output: output.slice(0, safeGraphemeEnd(output, budget)), filePath, version, bytesCaptured }
  } finally {
    await lease.release()
  }
}
