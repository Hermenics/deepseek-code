export interface ToolDiscoveryEvidence {
  query: string | null
  result: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Extract discover_tools results by their tool-call IDs, keeping malformed or missing evidence explicit. */
export function extractToolDiscoveryEvidence(transcript: unknown): ToolDiscoveryEvidence[] {
  if (!Array.isArray(transcript)) return []

  const messages = transcript as unknown[]
  const evidence: ToolDiscoveryEvidence[] = []
  for (const messageValue of messages) {
    const message = record(messageValue)
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue

    for (const callValue of message.tool_calls) {
      const call = record(callValue)
      const fn = record(call?.function)
      if (fn?.name !== 'discover_tools') continue

      let query: string | null = null
      if (typeof fn.arguments === 'string') {
        try {
          const args = record(JSON.parse(fn.arguments))
          if (typeof args?.query === 'string') query = args.query
        } catch { /* Invalid arguments provide no usable query evidence. */ }
      }

      let result: unknown = null
      if (typeof call?.id === 'string') {
        const resultMessage = messages
          .map(record)
          .find(candidate => candidate?.role === 'tool' && candidate.tool_call_id === call.id)
        if (typeof resultMessage?.content === 'string') {
          try { result = JSON.parse(resultMessage.content) }
          catch { /* Malformed tool output is not valid discovery evidence. */ }
        }
      }
      evidence.push({ query, result })
    }
  }
  return evidence
}
