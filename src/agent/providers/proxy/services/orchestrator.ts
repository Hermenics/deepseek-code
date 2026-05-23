import type { ProxyRequest, TokenEvent, ChatMessage } from '../types/index.js'
import type { ProxyConfig } from '../types/index.js'
import { PagePool } from '../browser/pool.js'
import { createDeepSeekStream } from './deepseek-api.js'
import { filterMessages } from './message-filter.js'
import { type ToolDef } from '../tools/prompt-emulation.js'
import { updateSessionParent } from '../browser/headers.js'


export async function* orchestrate(
  request: ProxyRequest,
  _pool: PagePool,
  _config: ProxyConfig,
): AsyncGenerator<TokenEvent> {
  try {
    const requestWithTools = request as ProxyRequest & { tools?: ToolDef[] }
    const tools = requestWithTools.tools ?? []

    const filteredMessages = filterMessages(request.messages)

    const { systemPrompt, prompt } = buildPrompt(filteredMessages, tools)
    const finalPrompt = systemPrompt ? `${systemPrompt}\n${prompt}` : prompt

    const isProModel = request.model.includes('pro')

    // New session if no assistant messages yet
    const isNewSession = !filteredMessages.some((m) => m.role === 'assistant')

    const { stream, chatSessionId } = await createDeepSeekStream({
      prompt: finalPrompt,
      enableThinking: true,
      isProModel,
      forcedParentId: isNewSession ? null : undefined,
    })

    const reader = stream.getReader()
    const decoder = new TextDecoder()

    let sseBuffer = ''
    let finished = false
    let currentAppendPath = ''
    let currentFragmentType = ''
    // Buffer to hold trailing tokens so we can strip DeepSeek's AI disclaimer
    let trailingBuffer = ''
    const TRAILING_HOLD = 200 // chars to hold back before flushing

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

          const extracted = extractDeepSeekText(chunk, currentAppendPath, currentFragmentType)
          currentAppendPath = extracted.appendPath
          currentFragmentType = extracted.fragmentType

          if (!extracted.text || extracted.text === 'FINISHED') continue

          if (extracted.isThinking) {
            yield { token: '', thinking: extracted.text, done: false }
          } else {
            trailingBuffer += extracted.text

            // Flush everything except the last TRAILING_HOLD chars
            if (trailingBuffer.length > TRAILING_HOLD) {
              const flushUpTo = trailingBuffer.length - TRAILING_HOLD
              const toFlush = trailingBuffer.slice(0, flushUpTo)
              trailingBuffer = trailingBuffer.slice(flushUpTo)
              yield { token: toFlush, done: false }
            }
          }
        } catch {
          // ignore malformed partial chunks
        }
      }
    }

    // Flush remaining buffer, stripping any AI disclaimer suffix
    if (trailingBuffer) {
      const cleaned = stripAiDisclaimer(trailingBuffer)
      if (cleaned) yield { token: cleaned, done: false }
    }

    yield { token: '', done: true }
    return
  } catch (error: unknown) {
    yield {
      token: '',
      done: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ─── Prompt Builder (mirrors deepsproxy/src/routes/chat.ts) ──────────────────

function buildPrompt(
  messages: ChatMessage[],
  tools: ToolDef[],
): { systemPrompt: string; prompt: string } {
  let systemPrompt = ''
  let prompt = ''

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    const contentStr = extractContent(msg)

    if (msg.role === 'system') {
      systemPrompt += contentStr + '\n\n'
    } else if (msg.role === 'user') {
      prompt += `User: ${contentStr}\n\n`
    } else if (msg.role === 'assistant') {
      let assistantContent = contentStr
      // Include tool calls in assistant turn if present
      const msgAny = msg as any
      if (msgAny.tool_calls && Array.isArray(msgAny.tool_calls)) {
        for (const tc of msgAny.tool_calls) {
          let args = tc.function?.arguments || '{}'
          if (typeof args !== 'string') args = JSON.stringify(args)
          assistantContent += `\n<tool_call>{"name": "${tc.function?.name}", "arguments": ${args}}</tool_call>`
        }
      }
      prompt += `Assistant: ${assistantContent.trim()}\n\n`
    } else if (msg.role === 'tool') {
      prompt += `Tool Response (${(msg as any).name || 'tool'}): ${contentStr}\n\n`
    }
  }

  // Inject tools into system prompt
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
    systemPrompt += `\n\n# TOOLS AVAILABLE\nYou have access to the following tools:\n${toolsJson}\n\nTo use a tool, you MUST output a JSON object wrapped EXACTLY in these tags:\n<tool_call>\n{"name": "tool_name", "arguments": {"param_name": "value"}}\n</tool_call>\n\nRULES:\n1. You can call multiple tools by outputting multiple <tool_call> blocks consecutively.\n2. Do NOT output any other text after your <tool_call> blocks. Wait for the user to provide the tool response.\n3. The JSON must be valid and accurately follow the tool's parameters.\n\n`

    const toolChoiceAny = (messages as any).tool_choice
    if (toolChoiceAny && typeof toolChoiceAny === 'object' && toolChoiceAny.function) {
      systemPrompt += `CRITICAL: You MUST call the tool "${toolChoiceAny.function.name}" in this response.\n\n`
    }
  }

  return { systemPrompt, prompt }
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

// ─── AI Disclaimer Stripper ───────────────────────────────────────────────────

const AI_DISCLAIMER_PATTERNS = [
  /\n*\*?\s*Esta resposta é gerada por IA[^]*$/i,
  /\n*\*?\s*This response is generated by AI[^]*$/i,
  /\n*\*?\s*Gerado por IA[^]*$/i,
  /\n*\*?\s*Generated by AI[^]*$/i,
  /\n*---\s*\n\*?Esta resposta[^]*$/i,
]

function stripAiDisclaimer(text: string): string {
  for (const pattern of AI_DISCLAIMER_PATTERNS) {
    const match = text.match(pattern)
    if (match && match.index !== undefined) {
      return text.slice(0, match.index).trimEnd()
    }
  }
  return text
}
