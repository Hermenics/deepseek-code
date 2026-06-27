/**
 * Decides whether accumulated streaming tokens should be buffered (possible tool call)
 * or flushed immediately (normal text).
 *
 * Returns true when the token MUST be buffered (could be a tool call).
 * Returns false when it should be emitted immediately (text or forced flush).
 */
export function shouldBuffer(accumulated: string): boolean {
  const trimmedStart = accumulated.trimStart()
  const startsLikeJson = trimmedStart.startsWith('{') || trimmedStart.startsWith('```')
  const containsToolMarker =
    accumulated.includes('"tool_use"') ||
    accumulated.includes('DSML') ||
    accumulated.includes('<tool_call>')

  return accumulated.length < BUFFER_MAX_LENGTH && (startsLikeJson || containsToolMarker)
}

/** Maximum accumulated length before forcing a flush */
export const BUFFER_MAX_LENGTH = 2000
