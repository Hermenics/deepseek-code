import { isAbsolute, relative, resolve, sep } from 'node:path'

export interface ReadFileEvidence {
  callId: string
  resultCallId: string | null
  arguments: Record<string, unknown> | null
  result: string | null
  resultUtf8Bytes: number | null
  reportedRanges: Array<{
    path: string | null
    startByte: number
    endByte: number
    totalBytes: number
  }>
}

export interface ReadFilePathAttempt {
  path: string | null
  resultObserved: boolean
  protectedPathDenied?: true
}

const PROTECTED_PATH_REFUSAL = 'Private runtime state cannot be accessed by general file tools'

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try { return record(JSON.parse(value)) ?? null }
  catch { return null }
}

function requestedPaths(args: Record<string, unknown> | null, workspaceRoot: string): Array<string | null> {
  if (!args) return [null]
  const hasPath = Object.hasOwn(args, 'path')
  const hasPaths = Object.hasOwn(args, 'paths')
  if (hasPath === hasPaths) return [null]
  if (hasPath) {
    return [typeof args.path === 'string' && args.path.trim() ? workspacePath(args.path, workspaceRoot) : null]
  }
  if (!Array.isArray(args.paths) || args.paths.length === 0) return [null]
  return args.paths.map(path => typeof path === 'string' && path.trim() ? workspacePath(path, workspaceRoot) : null)
}

function workspacePath(path: string, workspaceRoot: string): string | null {
  const root = resolve(workspaceRoot)
  const target = resolve(root, path)
  const relativePath = relative(root, target)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null
  return relativePath.split(sep).join('/')
}

function readFileOutput(result: string): string {
  try {
    const envelope = record(JSON.parse(result))
    const error = record(envelope?.error)
    const partial = record(envelope?.partial)
    if (envelope?.schemaVersion === 1 && envelope.status === 'partial'
      && error?.code === 'READ_FILE_PARTIAL' && typeof partial?.output === 'string') {
      return partial.output
    }
  } catch {}
  return result
}

function parseReportedRanges(result: string | null, workspaceRoot: string): ReadFileEvidence['reportedRanges'] {
  if (!result) return []
  result = readFileOutput(result)
  const ranges: ReadFileEvidence['reportedRanges'] = []
  const headers = /^\[([^\]\r\n]+?)\s+(\d+) bytes total\s+showing bytes (\d+)[–-](\d+)\][ \t]*$/gmu
  for (const match of result.matchAll(headers)) {
    const [, path, totalBytes, startByte, endByte] = match
    ranges.push({
      path: workspacePath(path!, workspaceRoot),
      totalBytes: Number(totalBytes),
      startByte: Number(startByte),
      endByte: Number(endByte),
    })
  }
  return ranges
}

/** Captures read_file calls and their correlated transcript results for isolated eval checkers. */
export function extractReadFileEvidence(transcript: unknown, workspaceRoot = process.cwd()): ReadFileEvidence[] {
  if (!Array.isArray(transcript)) return []
  const messages = transcript.map(record)
  const evidence: ReadFileEvidence[] = []
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const callValue of message.tool_calls) {
      const call = record(callValue)
      const fn = record(call?.function)
      if (fn?.name !== 'read_file' || typeof call?.id !== 'string') continue
      const resultMessage = messages.find(candidate => candidate?.role === 'tool' && candidate.tool_call_id === call.id)
      const resultCallId = typeof resultMessage?.tool_call_id === 'string' ? resultMessage.tool_call_id : null
      const result = typeof resultMessage?.content === 'string' ? resultMessage.content : null
      evidence.push({
        callId: call.id,
        resultCallId,
        arguments: parseArguments(fn.arguments),
        result,
        resultUtf8Bytes: result === null ? null : Buffer.byteLength(result, 'utf8'),
        reportedRanges: parseReportedRanges(result, workspaceRoot),
      })
    }
  }
  return evidence
}

/** Captures only normalized paths from read_file attempts; malformed or out-of-workspace paths stay unknown. */
export function extractReadFilePathAttempts(transcript: unknown, workspaceRoot = process.cwd()): ReadFilePathAttempt[] {
  if (!Array.isArray(transcript)) return []
  const messages = transcript.map(record)
  const attempts: ReadFilePathAttempt[] = []
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const callValue of message.tool_calls) {
      const call = record(callValue)
      const fn = record(call?.function)
      if (fn?.name !== 'read_file') continue
      const paths = requestedPaths(parseArguments(fn.arguments), workspaceRoot)
      const matchingResults = typeof call?.id === 'string'
        ? messages.filter(result => result?.role === 'tool' && result.tool_call_id === call.id)
        : []
      const resultContent = matchingResults.length === 1 && typeof matchingResults[0]?.content === 'string'
        ? matchingResults[0].content
        : null
      const protectedPathDenied = resultContent?.includes(PROTECTED_PATH_REFUSAL) ?? false
      for (const path of paths) {
        const attempt: ReadFilePathAttempt = { path, resultObserved: resultContent !== null }
        if (protectedPathDenied) attempt.protectedPathDenied = true
        attempts.push(attempt)
      }
    }
  }
  return attempts
}
