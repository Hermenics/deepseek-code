/**
 * Enhanced microCompact — lightweight context reduction without LLM calls.
 * Targets specific tool results that are safe to truncate (read-only tools).
 * More granular than the basic microCompact in autoCompact.ts.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { MessageOrBoundary } from '../../agent/compactBoundary.js'
import { isBoundaryMarker } from '../../agent/compactBoundary.js'
import { isToolErrorResult } from '../../tools/result.js'

const COMPACTABLE_TOOLS = new Set([
  'read_file', 'grep', 'glob', 'list_files', 'web_search', 'web_fetch',
  'file_search', 'directory_tree',
])

const TRUNCATION_NOTE = '[content cleared by micro-compaction to reduce context usage]'
const ACTIVE_CONSTRAINT = /\b(?:must(?:n't)?|shall|never|always|do not|don't|only|required|prohibited|forbidden|avoid|constraint|invariant|safety|security)\b/i

export interface MicroCompactOptions {
  keepLastN?: number
  maxContentLength?: number
  compactableTools?: Set<string>
  evidenceForCall?: (toolName: string, callId: string) => string | undefined
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

  // The provider format stores a tool name on the preceding assistant tool call,
  // not on its tool-result message.
  const toolCalls = new Map<string, { name: string; source?: string }>()
  for (const m of result) {
    if (isBoundaryMarker(m)) continue
    const message = m as ChatCompletionMessageParam & {
      tool_calls?: Array<{ id: string; function?: { name?: string } }>
    }
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) {
      if (!('function' in call) || !call.function?.name) continue
      let source: string | undefined
      try {
        const rawArguments = 'arguments' in call.function && typeof call.function.arguments === 'string' ? call.function.arguments : '{}'
        const args = JSON.parse(rawArguments) as { path?: unknown; paths?: unknown; pattern?: unknown; url?: unknown; query?: unknown }
        if (typeof args.path === 'string') source = args.path
        else if (Array.isArray(args.paths) && args.paths.every((path) => typeof path === 'string')) source = args.paths.join(', ')
        else if (typeof args.pattern === 'string') source = args.pattern
        else if (typeof args.url === 'string') source = args.url
        else if (typeof args.query === 'string') source = args.query
      } catch {
        // Malformed tool arguments do not prevent compacting unrelated results.
      }
      toolCalls.set(call.id, { name: call.function.name, source })
    }
  }

  // Collect indices of tool results from compactable tools.
  interface ToolResultInfo { index: number; toolName: string; source?: string; contentLength: number }
  const candidates: ToolResultInfo[] = []

  for (let i = 0; i < result.length; i++) {
    const m = result[i]!
    if (isBoundaryMarker(m)) continue
    const msg = m as ChatCompletionMessageParam & { content?: string; name?: string; tool_call_id?: string }
    if (msg.role !== 'tool') continue
    if (typeof msg.content !== 'string') continue
    if (msg.content.length <= maxContentLength) continue

    const call = toolCalls.get(msg.tool_call_id ?? '')
    const toolName = msg.name ?? call?.name ?? ''
    if (!compactableTools.has(toolName)) continue

    const source = call?.source ?? readFileSource(msg.content)
    // Preserve error details and likely instructions even when they are old. A
    // conservative false positive costs some compaction; a false negative can
    // erase a constraint the agent still needs to follow.
    if (isToolErrorResult(msg.content) || /^\s*Error\b/i.test(msg.content) || isInstructionSource(source) || ACTIVE_CONSTRAINT.test(msg.content)) continue

    candidates.push({ index: i, toolName, source, contentLength: msg.content.length })
  }

  // Keep the last N, truncate older ones
  const toTruncate = candidates.slice(0, Math.max(0, candidates.length - keepLastN))

  for (const { index, source } of toTruncate) {
    const msg = result[index] as ChatCompletionMessageParam & { content?: string; name?: string; tool_call_id?: string }
    const originalLength = msg.content?.length ?? 0
    const toolName = msg.name ?? toolCalls.get(msg.tool_call_id ?? '')?.name ?? 'unknown'
    const provenance = source ? `, source: ${source.slice(0, 240)}` : ''
    const evidenceId = options.evidenceForCall?.(toolName, msg.tool_call_id ?? '')
    const evidence = evidenceId ? `[Session evidence: ${evidenceId}]` : undefined
    const content = `${TRUNCATION_NOTE}\n[original tool: ${toolName}${provenance}, ${originalLength} chars]${evidence ? `\n${evidence}` : ''}`
    if (content.length >= originalLength) continue
    result[index] = {
      ...msg,
      content,
    } as MessageOrBoundary
    freedChars += originalLength - content.length
  }

  return {
    messages: result,
    freedTokensEstimate: Math.floor(freedChars / 4),
  }
}

function readFileSource(content: string): string | undefined {
  return content.match(/^\[([^\]\n]+?)\s+\d+ lines total\s+/)?.[1]
}

function isInstructionSource(source?: string): boolean {
  if (!source) return false
  return /(?:^|[,/\\])(?:AGENTS|CLAUDE|DEEPSEEK|GEMINI)\.md(?:$|[,/\\])/i.test(source)
    || /(?:^|[,/\\])\.deepseek[/\\]steering(?:[/\\]|$)/i.test(source)
}
