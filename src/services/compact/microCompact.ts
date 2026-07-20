/**
 * Enhanced microCompact — lightweight context reduction without LLM calls.
 * Targets specific tool results that are safe to truncate (read-only tools).
 * More granular than the basic microCompact in autoCompact.ts.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { MessageOrBoundary } from '../../agent/compactBoundary.js'
import { isBoundaryMarker } from '../../agent/compactBoundary.js'

const COMPACTABLE_TOOLS = new Set([
  'read_file', 'grep', 'glob', 'list_files', 'web_search', 'web_fetch',
  'file_search', 'directory_tree',
])

const TRUNCATION_NOTE = '[content cleared by micro-compaction to reduce context usage]'

export interface MicroCompactOptions {
  keepLastN?: number
  maxContentLength?: number
  compactableTools?: Set<string>
}

/**
 * Clears old tool results from compactable (read-only) tools.
 * Preserves recent results and short results. Does not call an LLM.
 */
export function enhancedMicroCompact(
  messages: MessageOrBoundary[],
  options: MicroCompactOptions = {},
): { messages: MessageOrBoundary[]; freedTokensEstimate: number } {
  const {
    keepLastN = 8,
    maxContentLength = 200,
    compactableTools = COMPACTABLE_TOOLS,
  } = options

  const result = [...messages]
  let freedChars = 0

  // Collect indices of tool results from compactable tools
  interface ToolResultInfo { index: number; toolName: string; contentLength: number }
  const candidates: ToolResultInfo[] = []

  for (let i = 0; i < result.length; i++) {
    const m = result[i]!
    if (isBoundaryMarker(m)) continue
    const msg = m as ChatCompletionMessageParam & { content?: string; name?: string }
    if (msg.role !== 'tool') continue
    if (typeof msg.content !== 'string') continue
    if (msg.content.length <= maxContentLength) continue

    const toolName = msg.name ?? ''
    if (!compactableTools.has(toolName)) continue

    candidates.push({ index: i, toolName, contentLength: msg.content.length })
  }

  // Keep the last N, truncate older ones
  const toTruncate = candidates.slice(0, Math.max(0, candidates.length - keepLastN))

  for (const { index } of toTruncate) {
    const msg = result[index] as ChatCompletionMessageParam & { content?: string; name?: string }
    const originalLength = msg.content?.length ?? 0
    result[index] = {
      ...msg,
      content: `${TRUNCATION_NOTE}\n[original tool: ${msg.name ?? 'unknown'}, ${originalLength} chars]`,
    } as MessageOrBoundary
    freedChars += originalLength - 80
  }

  return {
    messages: result,
    freedTokensEstimate: Math.floor(freedChars / 4),
  }
}

