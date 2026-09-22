import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

/** Pseudo-role marking where /compact cut the history; never sent to a provider. */
export const COMPACT_BOUNDARY_ROLE = '__compact_boundary__' as const
export type CompactBoundaryMarker = { role: typeof COMPACT_BOUNDARY_ROLE }
export type MessageOrBoundary = ChatCompletionMessageParam | CompactBoundaryMarker

/** Creates a marker to insert into history at a compaction point. */
export function createBoundaryMarker(): CompactBoundaryMarker {
  return { role: COMPACT_BOUNDARY_ROLE }
}

export function isBoundaryMarker(m: MessageOrBoundary): m is CompactBoundaryMarker {
  return m.role === COMPACT_BOUNDARY_ROLE
}

/** Returns the messages to send to the provider: the system prompt plus everything after the last compact boundary, with markers removed. */
export function getMessagesAfterBoundary(
  messages: MessageOrBoundary[]
): ChatCompletionMessageParam[] {
  if (messages.length === 0) return []

  // Reverse scan to find the last boundary
  let lastBoundaryIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isBoundaryMarker(messages[i]!)) {
      lastBoundaryIdx = i
      break
    }
  }

  if (lastBoundaryIdx === -1) {
    // No boundary — backward compatible, return everything without markers
    return messages.filter((m) => !isBoundaryMarker(m)) as ChatCompletionMessageParam[]
  }

  // System prompt is always messages[0]
  const systemMsg = messages[0]
  const afterBoundary = messages
    .slice(lastBoundaryIdx + 1)
    .filter((m) => !isBoundaryMarker(m)) as ChatCompletionMessageParam[]

  const isSystem = systemMsg && !isBoundaryMarker(systemMsg) && systemMsg.role === 'system'
  return isSystem ? [systemMsg as ChatCompletionMessageParam, ...afterBoundary] : afterBoundary
}
