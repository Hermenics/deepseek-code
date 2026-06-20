import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { MessageOrBoundary } from '../../agent/compactBoundary.js'
import { isBoundaryMarker } from '../../agent/compactBoundary.js'

export interface AutoCompactConfig {
  enabled: boolean
  threshold: number          // 0.0-1.0, default from settings or constant
  bufferTokens: number       // default 13000
  maxConsecutiveFailures: number  // circuit breaker, default 3
}

export interface CompactState {
  consecutiveFailures: number
  lastCompactTimestamp: number
}

export function createCompactState(): CompactState {
  return { consecutiveFailures: 0, lastCompactTimestamp: 0 }
}

export function createAutoCompactConfig(
  settings: { autoCompact?: boolean; autoCompactThreshold?: number },
  defaultThreshold: number,
): AutoCompactConfig {
  return {
    enabled: settings.autoCompact !== false, // default true
    threshold: settings.autoCompactThreshold ?? defaultThreshold,
    bufferTokens: 13_000,
    maxConsecutiveFailures: 3,
  }
}

/**
 * Determine if auto-compact should trigger.
 */
export function shouldAutoCompact(
  contextUsage: number,
  contextLimit: number,
  config: AutoCompactConfig,
  state: CompactState,
): boolean {
  if (!config.enabled) return false
  if (state.consecutiveFailures >= config.maxConsecutiveFailures) return false
  if (contextUsage <= 0 || contextLimit <= 0) return false
  return contextUsage / contextLimit > config.threshold
}

/**
 * MicroCompact: clear old tool result contents to save tokens.
 * Keeps the last N tool results intact, replaces older ones with a truncation note.
 * Operates on the full message array (boundaries are preserved as-is).
 * Returns a new array (does not mutate input).
 */
export function microCompact(
  messages: MessageOrBoundary[],
  keepLastN: number = 5,
): MessageOrBoundary[] {
  const result = [...messages]

  // Find indices of tool-result messages (role === 'tool')
  const toolResultIndices: number[] = []
  for (let i = 0; i < result.length; i++) {
    const m = result[i]!
    if (!isBoundaryMarker(m) && (m as ChatCompletionMessageParam).role === 'tool') {
      toolResultIndices.push(i)
    }
  }

  // Keep the last N, truncate older ones
  const toTruncate = toolResultIndices.slice(0, Math.max(0, toolResultIndices.length - keepLastN))

  for (const idx of toTruncate) {
    const msg = result[idx] as ChatCompletionMessageParam & { content?: string }
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 200) {
      result[idx] = { ...msg, content: '[tool result cleared to save context]' } as MessageOrBoundary
    }
  }

  return result
}
