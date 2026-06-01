import type { ProxyRequest, TokenEvent, ChatMessage } from '../types/index.js'
import type { ProxyConfig } from '../types/index.js'
import { PagePool } from '../browser/pool.js'
import { createDeepSeekStream } from './deepseek-api.js'
import { filterMessages } from './message-filter.js'
import { type ToolDef } from '../tools/prompt-emulation.js'
import { updateSessionParent } from '../browser/headers.js'
import { sanitizeOutput, sanitizeStreamChunk } from './output-sanitizer.js'
import { log } from '../config.js'

function isNetworkStreamError(message: string): boolean {
  const msg = message.toLowerCase()
  return /timeout|network|fetch failed|connection|econnr|socket|aborted|enotfound|epipe|net::|err_network/.test(msg)
}

export async function* orchestrate(
  request: ProxyRequest,
  _pool: PagePool,
  _config: ProxyConfig,
): AsyncGenerator<TokenEvent> {
  let lastError: string | undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const requestWithTools = request as ProxyRequest & { tools?: ToolDef[] }
      const tools = requestWithTools.tools ?? []

      const filteredMessages = filterMessages(request.messages)

      const { systemPrompt, prompt } = buildPrompt(filteredMessages, tools)
      const finalPrompt = systemPrompt ? `${systemPrompt}\n${prompt}` : prompt

      const isProModel = request.model.includes('pro')

      // Always force parent_message_id: null — the proxy sends the full conversation
      // history inside the prompt (native DeepSeek tokens), so the backend must be
      // treated as stateless per request. Using a stale parent_message_id from a
      // previous response causes DeepSeek to see duplicate context and stop responding.
      const { stream, chatSessionId } = await createDeepSeekStream({
        prompt: finalPrompt,
        enableThinking: true,
        isProModel,
        forcedParentId: null,
      })

      const reader = stream.getReader()
      const decoder = new TextDecoder()

      let sseBuffer = ''
      let finished = false
      let currentAppendPath = ''
      let currentFragmentType = ''
      let trailingBuffer = ''
      let completionTokens = 0
      // Sliding window: hold back enough chars to detect the longest possible
      // tool call start tag or DeepSeek marker (~71 chars for native markers)
      const TRAILING_HOLD = 80

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            finished = true
            break
          }

          try {
            const chunk = JSON.parse(data) as DeepSeekChunk
            const messageId = extractMessageId(chunk)
            if (messageId) updateSessionParent(chatSessionId, messageId)

            if (chunk.p === 'response/accumulated_token_usage' && typeof chunk.v === 'number') {
              completionTokens = chunk.v
              continue
            }

            const extracted = extractDeepSeekText(chunk, currentAppendPath, currentFragmentType)
            currentAppendPath = extracted.appendPath
            currentFragmentType = extracted.fragmentType

            if (!extracted.text || extracted.text === 'FINISHED') continue

            if (extracted.isThinking) {
              yield { token: '', thinking: extracted.text, done: false }
            } else {
              trailingBuffer += extracted.text

              if (trailingBuffer.length > TRAILING_HOLD) {
                const flushUpTo = trailingBuffer.length - TRAILING_HOLD
                let toFlush = trailingBuffer.slice(0, flushUpTo)
                toFlush = sanitizeStreamChunk(toFlush)
                trailingBuffer = trailingBuffer.slice(flushUpTo)
                if (toFlush) yield { token: toFlush, done: false }
              }
            }
          } catch (err) {
            log('debug', `Failed to parse SSE chunk: ${data}`)
          }
        }
      }

      if (trailingBuffer) {
        const cleaned = sanitizeOutput(trailingBuffer)
        if (cleaned) yield { token: cleaned, done: false }
      }

      const promptTokens = Math.ceil(finalPrompt.length / 3.5)
      yield { token: '', done: true, usage: { promptTokens, completionTokens } }
      return
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      lastError = msg

      if (!isNetworkStreamError(msg) || attempt === 2) {
        yield { token: '', done: true, error: msg }
        return
      }

      log('warn', `Stream attempt ${attempt + 1}/3 failed (network): ${msg}. Retrying...`)
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }

  yield { token: '', done: true, error: lastError || 'Unknown error after retries' }
}

// ─── Prompt Builder (DeepSeek Native Tokens) ─────────────────────────────────
// Uses DeepSeek's native conversation markers instead of plain "User:"/"Assistant:"
// This eliminates role prefix leakage because the model recognizes these as structural
// tokens, not text to echo back. Ported from deepseek-free-api.

// DeepSeek V3/R1 native conversation markers
const DS_BOS = '<｜begin▁of▁sentence｜>'
const DS_SYS = '<｜System｜>'
const DS_USER = '<｜User｜>'
const DS_ASST = '<｜Assistant｜>'
const DS_TOOL = '<｜Tool｜>'
const DS_EOS = '<｜end▁of▁sentence｜>'
const DS_TOOL_END = '<｜end▁of▁toolresults｜>'
const DS_SYS_END = '<｜end▁of▁instructions｜>'

function buildPrompt(
  messages: ChatMessage[],
  tools: ToolDef[],
): { systemPrompt: string; prompt: string } {
  // Build system content first (tools get injected here)
  let systemContent = ''

  // Inject tools into system content
  if (tools.length > 0) {
    const formattedTools = tools.map((t: any) => {
      if (t.type === 'function') {
        return {
          name: t.function.name,
          description: t.function.description || '',
          parameters: t.function.parameters,
        }
      }
      return { name: t.name, description: t.description || '', parameters: t.input_schema }
    })

    const toolsJson = JSON.stringify(formattedTools, null, 2)
    systemContent += `# TOOLS AVAILABLE\nYou have access to the following tools:\n${toolsJson}\n\nTo use a tool, you MUST output a JSON object wrapped EXACTLY in these tags:\n<tool_call>\n{"name": "tool_name", "arguments": {"param_name": "value"}}\n</tool_call>\n\nRULES:\n1. You can call multiple tools by outputting multiple <tool_call> blocks consecutively.\n2. Do NOT output any other text after your <tool_call> blocks. Wait for the user to provide the tool response.\n3. The JSON must be valid and accurately follow the tool's parameters.\n\n`

    const toolChoiceAny = (messages as any).tool_choice
    if (toolChoiceAny && typeof toolChoiceAny === 'object' && toolChoiceAny.function) {
      systemContent += `CRITICAL: You MUST call the tool "${toolChoiceAny.function.name}" in this response.\n\n`
    }
  }

  // Build the full prompt using native tokens
  const parts: string[] = [DS_BOS]
  let lastRole = ''

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    const contentStr = extractContent(msg)

    if (msg.role === 'system') {
      systemContent += contentStr + '\n\n'
    } else if (msg.role === 'user') {
      parts.push(DS_USER + contentStr + DS_EOS)
      lastRole = 'user'
    } else if (msg.role === 'assistant') {
      let assistantContent = contentStr
      // Preserve reasoning_content as <think> tags (ported from deepsproxy)
      const msgAny = msg as any
      if (msgAny.reasoning_content) {
        assistantContent = `<think>\n${msgAny.reasoning_content}\n</think>\n${assistantContent}`
      }
      // Include tool calls in assistant turn if present
      if (msgAny.tool_calls && Array.isArray(msgAny.tool_calls)) {
        for (const tc of msgAny.tool_calls) {
          let args = tc.function?.arguments || '{}'
          if (typeof args !== 'string') args = JSON.stringify(args)
          assistantContent += `\n<tool_call>{"name": "${tc.function?.name}", "arguments": ${args}}</tool_call>`
        }
      }
      parts.push(DS_ASST + assistantContent.trim() + DS_EOS)
      lastRole = 'assistant'
    } else if (msg.role === 'tool') {
      // Truncate very long tool results to avoid context overflow
      const result = contentStr.slice(0, 4000)
      parts.push(DS_TOOL + result + DS_TOOL_END + DS_EOS)
      lastRole = 'tool'
    }
  }

  // Insert system content at position 1 (after BOS)
  if (systemContent.trim()) {
    parts.splice(1, 0, DS_SYS + systemContent.trim() + DS_SYS_END)
  }

  // Ensure prompt ends with Assistant marker (model continues from here)
  if (lastRole !== 'assistant') {
    parts.push(DS_ASST)
  }

  // Return as combined prompt (systemPrompt empty since it's embedded in native format)
  return { systemPrompt: '', prompt: parts.join('') }
}

function extractContent(msg: ChatMessage): string {
  const content = (msg as any).content
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
  }
  if (typeof content === 'object' && content !== null) {
    return JSON.stringify(content)
  }
  return content || ''
}

// ─── SSE Chunk Parsing ────────────────────────────────────────────────────────

type DeepSeekChunk = {
  p?: string
  v?: unknown
  response_message_id?: number
  message_id?: number
}

function extractMessageId(chunk: DeepSeekChunk): number | null {
  if (typeof chunk.response_message_id === 'number') return chunk.response_message_id
  if (typeof chunk.message_id === 'number') return chunk.message_id

  const value = chunk.v
  if (value && typeof value === 'object') {
    const obj = value as { message_id?: unknown; response?: { message_id?: unknown } }
    if (typeof obj.response?.message_id === 'number') return obj.response.message_id
    if (typeof obj.message_id === 'number') return obj.message_id
  }

  return null
}

function extractDeepSeekText(
  chunk: DeepSeekChunk,
  previousAppendPath: string,
  previousFragmentType: string,
): { text: string; isThinking: boolean; appendPath: string; fragmentType: string } {
  let appendPath = previousAppendPath
  let fragmentType = previousFragmentType
  let text = ''

  if (typeof chunk.p === 'string') {
    appendPath = chunk.p
  }

  if (chunk.p === 'response/fragments' && Array.isArray(chunk.v)) {
    const lastFrag = chunk.v[chunk.v.length - 1] as { type?: unknown } | undefined
    if (typeof lastFrag?.type === 'string') fragmentType = lastFrag.type
  }

  if (typeof chunk.v === 'string') {
    text = chunk.v
  } else if (chunk.v && typeof chunk.v === 'object') {
    const value = chunk.v as {
      response?: { fragments?: Array<{ content?: unknown; type?: unknown }> }
      content?: unknown
      type?: unknown
    }

    const responseFragment = value.response?.fragments?.[0]
    if (typeof responseFragment?.content === 'string') {
      text = responseFragment.content
      fragmentType = typeof responseFragment.type === 'string' ? responseFragment.type : fragmentType
      appendPath = fragmentType === 'THINK' ? 'response/thinking_content' : 'response/content'
    } else if (Array.isArray(chunk.v)) {
      const first = chunk.v[0] as { content?: unknown; type?: unknown } | undefined
      if (typeof first?.content === 'string') {
        text = first.content
        fragmentType = typeof first.type === 'string' ? first.type : fragmentType
        appendPath = fragmentType === 'THINK' ? 'response/thinking_content' : 'response/content'
      }
    }
  }

  const isThinking =
    appendPath.includes('thinking_content') ||
    appendPath.includes('THINK') ||
    (appendPath.includes('fragments/-1/content') && fragmentType === 'THINK')

  return { text, isThinking, appendPath, fragmentType }
}
