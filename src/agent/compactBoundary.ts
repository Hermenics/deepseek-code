import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

export const COMPACT_BOUNDARY_ROLE = '__compact_boundary__' as const
export type CompactBoundaryMarker = { role: typeof COMPACT_BOUNDARY_ROLE }
export type MessageOrBoundary = ChatCompletionMessageParam | CompactBoundaryMarker

export function createBoundaryMarker(): CompactBoundaryMarker {
  return { role: COMPACT_BOUNDARY_ROLE }
}

export function isBoundaryMarker(m: MessageOrBoundary): m is CompactBoundaryMarker {
  return m.role === COMPACT_BOUNDARY_ROLE
}

export function getMessagesAfterBoundary(
  messages: MessageOrBoundary[]
): ChatCompletionMessageParam[] {
  if (messages.length === 0) return []

  // Scan reverso para encontrar o último boundary
  let lastBoundaryIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isBoundaryMarker(messages[i]!)) {
      lastBoundaryIdx = i
      break
    }
  }

  if (lastBoundaryIdx === -1) {
    // Sem boundary — backward compatible, retorna tudo sem markers
    return messages.filter((m) => !isBoundaryMarker(m)) as ChatCompletionMessageParam[]
  }

  // System prompt é sempre messages[0]
  const systemMsg = messages[0]
  const afterBoundary = messages
    .slice(lastBoundaryIdx + 1)
    .filter((m) => !isBoundaryMarker(m)) as ChatCompletionMessageParam[]

  const isSystem = systemMsg && !isBoundaryMarker(systemMsg) && systemMsg.role === 'system'
  return isSystem ? [systemMsg as ChatCompletionMessageParam, ...afterBoundary] : afterBoundary
}
