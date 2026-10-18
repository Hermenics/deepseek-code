import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { safeGraphemeEnd } from '../utils/textBoundaries.js'
import { redactSecrets } from '../orchestration/events.js'

/** Shared UTF-8 byte limit for one serialized tool-call/result round trip. */
export const TOOL_BATCH_BYTES = 40_000
// Kept for callers using the old character-limit constant; the cap now bounds serialized UTF-8 payloads.
export const TOOL_BATCH_CHARS = TOOL_BATCH_BYTES

/** Read-only tool results that the delegated executor historically charges to the shared byte budget. */
export const AGGREGATE_READ_TOOL_NAMES = new Set([
  'read_file', 'read_folder', 'grep', 'glob', 'web_fetch', 'discover_tools', 'session_evidence',
])

/** Tool outputs charged at their capture source; charging their returned model envelope again would double-count them. */
export const AGGREGATE_SOURCE_ACCOUNTED_TOOL_NAMES = new Set(['shell'])

/**
 * Maximum UTF-8 size of one complete serialized provider request body.
 * This 4 MiB ceiling is independent of the 40 KB tool round-trip cap and includes schemas and encoded images.
 * It is a byte bound, not a provider-token estimate; oversized requests fail closed without truncation.
 */
export const CONVERSATION_MESSAGE_BYTES = 4 * 1024 * 1024

/** Reject a provider request whose complete serialized message history exceeds the shared ceiling. */
export function assertConversationMessageBudget(messages: unknown): number {
  if (!Array.isArray(messages)) throw new Error('Provider request rejected: conversation messages are unavailable for size validation.')

  let serialized: string | undefined
  try {
    serialized = JSON.stringify(messages)
  } catch {
    throw new Error('Provider request rejected: conversation messages could not be serialized for size validation.')
  }
  if (serialized === undefined) throw new Error('Provider request rejected: conversation messages could not be serialized for size validation.')

  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > CONVERSATION_MESSAGE_BYTES) {
    throw new Error(`Provider request rejected: serialized conversation messages exceed the 4 MiB UTF-8 limit (${bytes} bytes). Compact history or remove large attachments, then retry.`)
  }
  return bytes
}

/** Rejects a provider request whose complete JSON body exceeds the shared UTF-8 ceiling. */
export function assertProviderRequestBudget(request: unknown): number {
  if (!request || typeof request !== 'object' || Array.isArray(request) || !Array.isArray((request as { messages?: unknown }).messages)) {
    throw new Error('Provider request rejected: conversation messages are unavailable for size validation.')
  }

  let serialized: string | undefined
  try {
    serialized = JSON.stringify(request)
  } catch {
    throw new Error('Provider request rejected: request body could not be serialized for size validation.')
  }
  if (serialized === undefined) throw new Error('Provider request rejected: request body is unavailable for size validation.')

  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > CONVERSATION_MESSAGE_BYTES) {
    throw new Error(`Provider request rejected: serialized provider request exceeds the 4 MiB UTF-8 limit (${bytes} bytes). Compact history or remove large attachments and tool schemas, then retry.`)
  }
  return bytes
}

export interface PromptToolResult {
  name: string
  result: string
}

const serializedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const contentBytes = (content: unknown) => serializedBytes(content) - 2
const bedrockResult = (name: string, result: string) => `<tool_result>\n<name>${name}</name>\n<result>${result}</result>\n</tool_result>`

/** True when serialized call input plus the required empty result envelopes fit one shared round trip. */
export function toolBatchFitsBudget(inputBytes: number, emptyResultsBytes: number): boolean {
  return Number.isSafeInteger(inputBytes) && inputBytes >= 0 &&
    Number.isSafeInteger(emptyResultsBytes) && emptyResultsBytes >= 0 &&
    inputBytes <= TOOL_BATCH_BYTES - emptyResultsBytes
}

/** Serialized redacted empty native result envelopes reserved before any call in a batch may run. */
export function nativeToolResultEnvelopeBytes(callIds: readonly string[]): number {
  return serializedBytes(redactSecrets(callIds.map(tool_call_id => ({ role: 'tool', tool_call_id, content: '' }))))
}

/** Serialized redacted native tool-call array, including call metadata and JSON escaping. */
export function nativeToolCallPayloadBytes(calls: readonly unknown[]): number {
  return serializedBytes(redactSecrets(calls))
}

type NativeToolCallBudgetInput = { id: string; type: 'function'; function: { name: string; arguments: string } }

function isNativeToolCallBudgetInput(call: unknown): call is NativeToolCallBudgetInput {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return false
  const candidate = call as { id?: unknown; type?: unknown; function?: unknown }
  if (typeof candidate.id !== 'string' || candidate.type !== 'function' ||
    !candidate.function || typeof candidate.function !== 'object' || Array.isArray(candidate.function)) return false
  const callable = candidate.function as { name?: unknown; arguments?: unknown }
  return typeof callable.name === 'string' && typeof callable.arguments === 'string'
}

/** Checks the complete redacted native call array and empty result envelopes before dispatch. */
export function nativeToolBatchFitsBudget(calls: readonly unknown[]): boolean {
  try {
    if (!calls.every(isNativeToolCallBudgetInput)) return false
    const inputBytes = nativeToolCallPayloadBytes(calls)
    return toolBatchFitsBudget(inputBytes, nativeToolResultEnvelopeBytes(calls.map(call => call.id)))
  } catch {
    return false
  }
}

/** Minimum serialized Bedrock result batch size, used to reserve envelopes before any tool runs. */
export function bedrockToolResultEnvelopeBytes(names: string[]): number {
  return serializedBytes(names.map(name => ({ role: 'user', content: bedrockResult(name, '') })))
}

/** Caps Bedrock's prompt-based tool results against the bytes used by its retained call blocks. */
export function boundBedrockToolResults(results: PromptToolResult[], inputBytes: number): string[] {
  const maxBytes = TOOL_BATCH_BYTES - inputBytes
  const messages = results.map(({ name, result }) => ({ role: 'user', content: bedrockResult(name, result) }))
  if (maxBytes < 0) return ['[Tool batch rejected before execution: call payload exceeds the round-trip budget. Split the calls.]']
  if (serializedBytes(messages) <= maxBytes) return messages.map(message => message.content)

  const empty = results.map(({ name }) => ({ role: 'user', content: bedrockResult(name, '') }))
  const baseBytes = serializedBytes(empty)
  if (baseBytes > maxBytes) return ['[Tool batch rejected before execution: required result envelopes exceed the round-trip budget. Split the calls.]']

  let remaining = maxBytes - baseBytes
  return results.map(({ name, result }, index) => {
    const allowance = Math.floor(remaining / (results.length - index))
    const content = boundedContent({ role: 'tool', tool_call_id: `bedrock-${index}`, content: result }, allowance) as string
    remaining -= contentBytes(content)
    return bedrockResult(name, content)
  })
}

function boundedContent(message: Extract<ChatCompletionMessageParam, { role: 'tool' }>, allowance: number, evidenceId?: string) {
  const original = typeof message.content === 'string' ? message.content : JSON.stringify(message.content) ?? ''
  if (contentBytes(message.content) <= allowance) return message.content

  const reference = evidenceId ? `[Session evidence: ${evidenceId}]` : original.match(/\[Session evidence: [a-f0-9-]{36}\]/)?.[0]
  const note = `\n[Batch output budget exhausted; recover source using session_evidence.]\n${reference ?? '[Legacy result has no recoverable source]'}\n`
  let suffix = note
  if (contentBytes(suffix) > allowance) {
    suffix = reference && contentBytes(reference) <= allowance
      ? reference
      : '[Recover using session_evidence]'
    if (contentBytes(suffix) > allowance) suffix = ''
  }

  let low = 0
  let high = original.length
  while (low < high) {
    const end = Math.ceil((low + high) / 2)
    if (contentBytes(original.slice(0, end) + suffix) <= allowance) low = end
    else high = end - 1
  }
  low = safeGraphemeEnd(original, low)
  let content = `${original.slice(0, low)}${suffix}`
  while (contentBytes(content) > allowance && content.length > suffix.length) {
    low = safeGraphemeEnd(original, low - 1)
    content = `${original.slice(0, low)}${suffix}`
  }
  return content
}

function boundToolBatch(messages: Extract<ChatCompletionMessageParam, { role: 'tool' }>[], maxBytes: number, evidenceId?: (callId: string) => string | undefined): ChatCompletionMessageParam[] {
  if (serializedBytes(messages) <= maxBytes) return messages

  const empty = messages.map(message => ({ ...message, content: '' }))
  const baseBytes = serializedBytes(empty)
  if (baseBytes > maxBytes) {
    throw new Error(`Tool batch cannot fit even empty serialized results; tool-result envelopes exceed the ${maxBytes}-byte remaining round-trip budget. Compact history before requesting another model response.`)
  }

  let remaining = maxBytes - baseBytes
  return messages.map((message, index) => {
    const allowance = Math.floor(remaining / (messages.length - index))
    const content = boundedContent(message, allowance, evidenceId?.(message.tool_call_id))
    remaining -= contentBytes(content)
    return content === message.content ? message : { ...message, content }
  })
}

/** Bounds each native tool-result batch against the remaining bytes after its paired serialized call payload. */
export function boundToolMessages(messages: ChatCompletionMessageParam[], evidenceId?: (callId: string) => string | undefined): ChatCompletionMessageParam[] {
  const bounded: ChatCompletionMessageParam[] = []
  let precedingBatch: { callIds: Set<string>; payloadBytes: number } | undefined
  for (let start = 0; start < messages.length;) {
    const message = messages[start]!
    if (message.role === 'assistant') {
      const calls = message.tool_calls ?? []
      precedingBatch = calls.length ? {
        callIds: new Set(calls.map(call => call.id)),
        payloadBytes: nativeToolCallPayloadBytes(calls),
      } : undefined
      bounded.push(message)
      start++
      continue
    }

    if (message.role !== 'tool') {
      bounded.push(message)
      start++
      continue
    }

    let end = start + 1
    while (messages[end]?.role === 'tool') end++
    const results = messages.slice(start, end) as Extract<ChatCompletionMessageParam, { role: 'tool' }>[]
    const related = precedingBatch && results.some(result => precedingBatch!.callIds.has(result.tool_call_id))
    const payloadBytes = related ? precedingBatch!.payloadBytes : 0
    if (!toolBatchFitsBudget(payloadBytes, 0)) {
      throw new Error(`Serialized tool-call payload already exceeds the ${TOOL_BATCH_BYTES}-byte round-trip budget; results cannot be sent safely.`)
    }
    bounded.push(...boundToolBatch(results, TOOL_BATCH_BYTES - payloadBytes, evidenceId))
    start = end
  }
  return bounded
}
