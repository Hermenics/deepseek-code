import { safeGraphemeEnd } from '../utils/textBoundaries.js'

export type ToolErrorKind = 'validation' | 'tool' | 'conflict' | 'permission'

export interface ToolErrorEnvelopeV1 {
  schemaVersion: 1
  status: 'error' | 'partial'
  error: {
    kind: ToolErrorKind
    code: string
    message: string
    retryable: boolean
  }
  partial?: unknown
}

export function formatToolError(kind: ToolErrorKind, code: string, message: string, retryable = false, partial?: unknown): string {
  const result: ToolErrorEnvelopeV1 = {
    schemaVersion: 1,
    status: partial === undefined ? 'error' : 'partial',
    error: { kind, code, message, retryable },
    ...(partial === undefined ? {} : { partial }),
  }
  return JSON.stringify(result)
}

export function isToolErrorResult(result: string): boolean {
  try {
    const value = JSON.parse(result) as Partial<ToolErrorEnvelopeV1>
    return value.schemaVersion === 1 && (value.status === 'error' || value.status === 'partial') && typeof value.error?.code === 'string'
      && typeof value.error.message === 'string' && typeof value.error.retryable === 'boolean'
      && (value.status !== 'partial' || Object.prototype.hasOwnProperty.call(value, 'partial'))
  } catch {
    return false
  }
}

/** Keeps machine-readable codes and completed subresults when a typed tool error crosses a runtime boundary. */
export function normalizeToolException(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown tool failure')
  if (error instanceof Error) {
    const details = error as Error & { code?: unknown; partial?: unknown; retryable?: unknown }
    const cancelled = error.name === 'AbortError'
    const code = cancelled ? 'CANCELLED'
      : typeof details.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(details.code) ? details.code : 'TOOL_ERROR'
    const shellExecution = !cancelled && (code === 'SHELL_EXIT' || code === 'SHELL_SIGNAL' || code === 'TIMED_OUT' || code === 'CANCELLED')
    if (shellExecution) {
      const normalized = normalizeToolResult(`Error: ${message}`)
      if (isToolErrorResult(normalized)) {
        const envelope = JSON.parse(normalized) as ToolErrorEnvelopeV1
        if (envelope.status === 'partial' && envelope.partial && typeof envelope.partial === 'object' && !Array.isArray(envelope.partial)) {
          const prior = details.partial && typeof details.partial === 'object' && !Array.isArray(details.partial)
            ? details.partial as Record<string, unknown> : {}
          const partial = { ...prior, ...envelope.partial as Record<string, unknown> }
          if (code === 'CANCELLED') partial.state = 'cancelled'
          return formatToolError('tool', code, envelope.error.message, false, partial)
        }
      }
    }
    const retryable = !cancelled && !shellExecution && typeof details.retryable === 'boolean' ? details.retryable : false
    try {
      return formatToolError('tool', code, message, retryable, details.partial)
    } catch {
      return formatToolError('tool', code, message, retryable)
    }
  }
  return normalizeToolResult(`Error: ${message}`)
}

/** Converts explicit legacy error strings at runtime boundaries while leaving ordinary tool output byte-for-byte unchanged. */
export function normalizeToolResult(result: string): string {
  if (isToolErrorResult(result)) return result

  const shellFailure = /^(Error|Cancelled): (?:(\[sandbox unavailable[^\]\n]*\]\n))?(Command timed out after \d+(?:\.\d+)?s(?: and was killed)?\.|Command exited with code (?:unknown|\d+)\.|Command was terminated by signal [A-Za-z0-9]+\.)(?:[ \t]+([^\r\n]*))?(?:\n([\s\S]*))?$/.exec(result)
  if (shellFailure) {
    const [, prefix, notice, status, inlineOutput = '', followingOutput = ''] = shellFailure
    const output = `${inlineOutput}${inlineOutput && followingOutput ? '\n' : ''}${followingOutput}`
    const exitCode = /^Command exited with code (\d+)\.$/.exec(status!)?.[1]
    const signal = /^Command was terminated by signal ([A-Za-z0-9]+)\.$/.exec(status!)?.[1] ?? null
    const cancelled = prefix === 'Cancelled'
    const timedOut = status!.startsWith('Command timed out')
    const exited = status!.startsWith('Command exited')
    const outputId = /shell output_id="([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"/i.exec(output)?.[1]
    // Keep nested JSON previews below the 40 KB tool-round-trip budget, even after serialization.
    const outputEnd = safeGraphemeEnd(output, 1_000)
    return formatToolError('tool', cancelled ? 'CANCELLED' : timedOut ? 'TIMED_OUT' : exited ? 'SHELL_EXIT' : 'SHELL_SIGNAL',
      [notice?.trim(), status].filter(Boolean).join('\n'), false, {
        state: cancelled ? 'cancelled' : timedOut ? 'timed_out' : 'failed',
        exitCode: exitCode === undefined ? null : Number(exitCode),
        signal,
        output: output.slice(0, outputEnd),
        ...(outputId ? { outputId } : {}),
        outputIncomplete: /Pipe drain deadline reached|Captured output is incomplete|output may be missing/i.test(output),
        outputPreviewTruncated: outputEnd < output.length,
      })
  }

  const blocked = /^Command blocked\s+[—-]\s*([\s\S]*)$/.exec(result)
  if (blocked) return formatToolError('permission', 'TOOL_BLOCKED', blocked[1]!.trim())

  const cancelled = /^Cancelled:\s?([\s\S]*)$/.exec(result)
  if (cancelled) return formatToolError('tool', 'TOOL_CANCELLED', cancelled[1]!.trim())

  const invalidArguments = /^\[Tool Error:[^\]]+\]\s+Invalid arguments:\s*\n?([\s\S]*)$/.exec(result)
  if (invalidArguments) {
    const message = invalidArguments[1]!.split('\n').map(line => line.replace(/^-\s*/, '')).join('\n').trim()
    return formatToolError('validation', 'INVALID_ARGUMENTS', message || 'Tool arguments are invalid')
  }

  const toolError = /^Error:\s?([\s\S]*)$/.exec(result)
  if (toolError) return formatToolError('tool', 'TOOL_ERROR', toolError[1]!.trim())

  if (/^Unknown action:\s*/.test(result)) return formatToolError('validation', 'INVALID_ARGUMENTS', result.trim())

  try {
    const value = JSON.parse(result) as { error?: unknown; [key: string]: unknown }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const error = value.error && typeof value.error === 'object' && !Array.isArray(value.error)
        ? value.error as Record<string, unknown> : undefined
      const status = typeof value.status === 'string' ? value.status.toLowerCase() : undefined
      const cancelled = value.cancelled === true
      const statusCode = cancelled ? 'TOOL_CANCELLED'
        : status === 'cancelled' || status === 'canceled' ? 'CANCELLED'
        : status === 'timed_out' || status === 'timeout' ? 'TIMED_OUT' : undefined
      const failed = cancelled || value.success === false || value.ok === false || ['error', 'failed', 'cancelled', 'canceled', 'timed_out', 'timeout'].includes(status ?? '')
      const message = typeof value.error === 'string' && value.error.trim() ? value.error
        : typeof error?.message === 'string' && error.message.trim() ? error.message
          : failed && typeof value.message === 'string' && value.message.trim() ? value.message
            : cancelled ? 'Tool was cancelled'
            : failed ? `Tool reported ${status ?? 'unsuccessful'} status`
              : typeof error?.code === 'string' ? `Tool returned error code ${error.code}` : undefined
      const onlyErrorField = Object.keys(value).every(key => key === 'error')
      const explicitErrorObject = error && (typeof error.message === 'string' || typeof error.code === 'string')
      if (message && (onlyErrorField || failed || explicitErrorObject)) {
        const details = Object.fromEntries(Object.entries(value).filter(([key]) => ![
          'success', 'ok', 'status', 'cancelled', 'error', 'code', 'kind', 'retryable',
        ].includes(key)))
        const errorDetails = error && Object.fromEntries(Object.entries(error).filter(([key]) => ![
          'code', 'kind', 'message', 'retryable',
        ].includes(key)))
        if (errorDetails && Object.keys(errorDetails).length) details.errorDetails = errorDetails

        const rawCode = error?.code ?? value.code ?? statusCode
        const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'TOOL_ERROR'
        const rawKind = error?.kind ?? value.kind
        const kind: ToolErrorKind = rawKind === 'validation' || rawKind === 'conflict' || rawKind === 'permission' ? rawKind : 'tool'
        const retryable = typeof error?.retryable === 'boolean' ? error.retryable : value.retryable === true
        return formatToolError(kind, code, message, retryable, Object.keys(details).length ? details : undefined)
      }
    }
  } catch { /* Ordinary tool text is not required to be JSON. */ }

  return result
}
