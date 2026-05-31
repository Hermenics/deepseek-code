import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { validateRequest } from '../services/validator.js'
import * as openai from '../formatters/openai.js'
import { orchestrate } from '../services/orchestrator.js'
import { robustParseJSON } from '../services/robust-json.js'
import { isInsideCodeFence, resolveToolName } from '../services/output-sanitizer.js'
import { log } from '../config.js'
import type { PagePool } from '../browser/pool.js'
import type { ProxyConfig } from '../types/index.js'

export function doubleMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '****$1****')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '__$1__')
    .replace(/^(#{1,6})\s/gm, (_, hashes: string) => `${hashes}# `)
}

function hasCompleteMarkdown(text: string): boolean {
  const boldCount = (text.match(/\*\*/g) || []).length
  const italicSingles = (text.match(/(?<!\*)\*(?!\*)/g) || []).length
  return boldCount % 2 === 0 && italicSingles % 2 === 0
}

function extractBalancedJsonFromStr(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"' && !escape) { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

export function createOpenAIRouter(pool: PagePool, config: ProxyConfig) {
  const router = new Hono()

  router.get('/v1/models', (c) => c.json(openai.formatModelList()))

  router.post('/v1/chat/completions', async (c) => {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400)
    }

    const error = validateRequest(body)
    if (error) return c.json({ error: { message: error, type: 'invalid_request_error' } }, 400)

    const request = openai.parseRequest(body)
    log('info', `OpenAI request: model=${request.model} stream=${request.stream} messages=${request.messages.length}`)

    if (request.stream) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')
        c.header('Connection', 'keep-alive')
        try {
          const TOOL_START = '<tool_call>'
          const TOOL_END = '</tool_call>'
          const TOOL_USE_PREFIX = '{"tool_use"'
          // Native DeepSeek markers (with Unicode variants normalized)
          const NATIVE_TOOL_START_RE = /<[｜|]tool[_▁\s]?calls[_▁\s]?begin[｜|]>/i
          const NATIVE_TOOL_END_RE = /<[｜|]tool[_▁\s]?calls[_▁\s]?end[｜|]>/i
          let insideTool = false
          let insideToolUseJson = false
          let insideNativeTool = false
          let emittedToolCallCount = 0
          let contentEmitBuffer = ''
          let toolCallDone = false // Truncate post-tool text (from ds-free-api)
          let finalUsage: { promptTokens: number; completionTokens: number } | undefined

          // Extract known tool names for fuzzy resolution
          const knownToolNames: string[] = (request as any).tools?.map((t: any) =>
            t.function?.name || t.name || ''
          ).filter(Boolean) ?? []

          for await (const event of orchestrate(request, pool, config)) {
            if (event.error) {
              await s.write(`data: ${JSON.stringify({ error: { message: event.error } })}\n\n`)
              await s.write(openai.formatStreamEnd(emittedToolCallCount > 0 ? 'tool_calls' : 'stop', finalUsage))
              break
            }

            if (event.thinking) {
              await s.write(openai.formatStreamReasoning(event.thinking, request.model))
              continue
            }

            if (event.done) {
              finalUsage = event.usage
              if (!insideTool && !toolCallDone && contentEmitBuffer) {
                await s.write(openai.formatStreamChunk(doubleMarkdown(contentEmitBuffer), request.model))
                contentEmitBuffer = ''
              }
              await s.write(openai.formatStreamEnd(emittedToolCallCount > 0 ? 'tool_calls' : 'stop', finalUsage))
              break
            }

            // Post-tool truncation: after emitting tool calls, ignore all subsequent text
            // The model often adds "I'll read that file for you" after the tool call JSON
            if (toolCallDone) continue

            contentEmitBuffer += event.token

            while (contentEmitBuffer.length > 0) {
              if (!insideTool && !insideToolUseJson && !insideNativeTool) {
                const startIdx = contentEmitBuffer.indexOf(TOOL_START)
                if (startIdx !== -1) {
                  // Code fence check: skip if <tool_call> is inside ``` block (it's an example)
                  if (isInsideCodeFence(contentEmitBuffer, startIdx)) {
                    // Flush everything including the tag as normal text
                    const flushTo = startIdx + TOOL_START.length
                    const textToEmit = contentEmitBuffer.substring(0, flushTo)
                    if (textToEmit && emittedToolCallCount === 0 && hasCompleteMarkdown(textToEmit)) {
                      await s.write(openai.formatStreamChunk(doubleMarkdown(textToEmit), request.model))
                    }
                    contentEmitBuffer = contentEmitBuffer.substring(flushTo)
                    continue
                  }
                  const textBefore = contentEmitBuffer.substring(0, startIdx)
                  if (textBefore && emittedToolCallCount === 0 && hasCompleteMarkdown(textBefore)) {
                    await s.write(openai.formatStreamChunk(doubleMarkdown(textBefore), request.model))
                  }
                  insideTool = true
                  contentEmitBuffer = contentEmitBuffer.substring(startIdx + TOOL_START.length)
                  continue
                }

                // Detect native DeepSeek <|tool_calls_begin|> markers
                const nativeStartMatch = contentEmitBuffer.match(NATIVE_TOOL_START_RE)
                if (nativeStartMatch && nativeStartMatch.index !== undefined) {
                  const nStartIdx = nativeStartMatch.index
                  if (!isInsideCodeFence(contentEmitBuffer, nStartIdx)) {
                    const textBefore = contentEmitBuffer.substring(0, nStartIdx)
                    if (textBefore && emittedToolCallCount === 0 && hasCompleteMarkdown(textBefore)) {
                      await s.write(openai.formatStreamChunk(doubleMarkdown(textBefore), request.model))
                    }
                    insideNativeTool = true
                    contentEmitBuffer = contentEmitBuffer.substring(nStartIdx + nativeStartMatch[0].length)
                    continue
                  }
                }

                // Detect {"tool_use": ...} format (OAuth fallback without <tool_call> tags)
                const toolUseIdx = contentEmitBuffer.indexOf(TOOL_USE_PREFIX)
                if (toolUseIdx !== -1) {
                  const textBefore = contentEmitBuffer.substring(0, toolUseIdx)
                  if (textBefore && emittedToolCallCount === 0 && hasCompleteMarkdown(textBefore)) {
                    await s.write(openai.formatStreamChunk(doubleMarkdown(textBefore), request.model))
                  }
                  insideToolUseJson = true
                  contentEmitBuffer = contentEmitBuffer.substring(toolUseIdx)
                  continue
                }

                let flushIndex = contentEmitBuffer.length
                for (let i = 1; i <= TOOL_START.length; i++) {
                  if (contentEmitBuffer.endsWith(TOOL_START.substring(0, i))) {
                    flushIndex = contentEmitBuffer.length - i
                    break
                  }
                }
                // Also hold back if buffer ends with partial {"tool_use" prefix
                for (let i = 1; i <= TOOL_USE_PREFIX.length; i++) {
                  if (contentEmitBuffer.endsWith(TOOL_USE_PREFIX.substring(0, i))) {
                    const candidate = contentEmitBuffer.length - i
                    if (candidate < flushIndex) flushIndex = candidate
                    break
                  }
                }
                const textToEmit = contentEmitBuffer.substring(0, flushIndex)
                if (textToEmit && emittedToolCallCount === 0 && hasCompleteMarkdown(textToEmit)) {
                  await s.write(openai.formatStreamChunk(doubleMarkdown(textToEmit), request.model))
                }
                contentEmitBuffer = contentEmitBuffer.substring(flushIndex)
                break
              }

              // Inside {"tool_use": ...} JSON accumulation
              if (insideToolUseJson) {
                // Try to find balanced braces
                let depth = 0
                let inStr = false
                let esc = false
                let endPos = -1
                for (let i = 0; i < contentEmitBuffer.length; i++) {
                  const ch = contentEmitBuffer[i]!
                  if (esc) { esc = false; continue }
                  if (ch === '\\' && inStr) { esc = true; continue }
                  if (ch === '"' && !esc) { inStr = !inStr; continue }
                  if (inStr) continue
                  if (ch === '{') depth++
                  else if (ch === '}') {
                    depth--
                    if (depth === 0) { endPos = i; break }
                  }
                }

                if (endPos === -1) break // incomplete JSON, wait for more tokens

                const jsonStr = contentEmitBuffer.substring(0, endPos + 1)
                try {
                  const parsed = robustParseJSON(jsonStr) as { tool_use?: { name?: string; arguments?: unknown } }
                  if (parsed && parsed.tool_use && parsed.tool_use.name) {
                    const toolId = 'call_' + randomUUID()
                    const rawName = parsed.tool_use.name
                    const toolName = resolveToolName(rawName, knownToolNames) || rawName
                    const toolArgs = parsed.tool_use.arguments || {}
                    await s.write(openai.formatStreamToolCall(
                      { id: toolId, name: toolName, arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs) },
                      request.model,
                      emittedToolCallCount,
                    ))
                    emittedToolCallCount++
                    toolCallDone = true // Truncate any text after tool calls
                  }
                } catch {
                  // Malformed JSON — suppress it (don't leak to user)
                }

                insideToolUseJson = false
                contentEmitBuffer = contentEmitBuffer.substring(endPos + 1)
                continue
              }

              // Inside native DeepSeek <|tool_calls_begin|> ... <|tool_calls_end|>
              if (insideNativeTool) {
                const nativeEndMatch = contentEmitBuffer.match(NATIVE_TOOL_END_RE)
                if (!nativeEndMatch || nativeEndMatch.index === undefined) break // wait for end marker

                const inner = contentEmitBuffer.substring(0, nativeEndMatch.index).trim()
                // Parse the inner content — could be JSON array/object or <tool_call> blocks
                const toolCallInner = inner.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/)
                if (toolCallInner) {
                  const tcJson = extractBalancedJsonFromStr(toolCallInner[1]!.trim())
                  if (tcJson) {
                    try {
                      const toolCallObj = robustParseJSON(tcJson) as { name?: string; arguments?: unknown }
                      if (toolCallObj && toolCallObj.name) {
                        const rawName = toolCallObj.name
                        const toolName = resolveToolName(rawName, knownToolNames) || rawName
                        const toolArgs = toolCallObj.arguments || {}
                        await s.write(openai.formatStreamToolCall(
                          { id: 'call_' + randomUUID(), name: toolName, arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs) },
                          request.model,
                          emittedToolCallCount,
                        ))
                        emittedToolCallCount++
                        toolCallDone = true
                      }
                    } catch { }
                  }
                } else {
                  // Try direct JSON parse of inner content
                  const jsonContent = extractBalancedJsonFromStr(inner)
                  if (jsonContent) {
                    try {
                      const parsed = robustParseJSON(jsonContent)
                      const items = Array.isArray(parsed) ? parsed : [parsed]
                      for (const item of items) {
                        if (item && item.name) {
                          const rawName = item.name
                          const toolName = resolveToolName(rawName, knownToolNames) || rawName
                          const toolArgs = item.arguments || {}
                          await s.write(openai.formatStreamToolCall(
                            { id: 'call_' + randomUUID(), name: toolName, arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs) },
                            request.model,
                            emittedToolCallCount,
                          ))
                          emittedToolCallCount++
                          toolCallDone = true
                        }
                      }
                    } catch { }
                  }
                }

                insideNativeTool = false
                contentEmitBuffer = contentEmitBuffer.substring(nativeEndMatch.index + nativeEndMatch[0].length)
                continue
              }

              const endIdx = contentEmitBuffer.indexOf(TOOL_END)
              if (endIdx === -1) break

              const toolJsonStr = contentEmitBuffer.substring(0, endIdx).trim()
              try {
                const toolCallObj = robustParseJSON(toolJsonStr) as { name?: string; arguments?: unknown }
                if (!toolCallObj) throw new Error('Empty tool call')
                // Fuzzy tool name resolution (from deepseek-free-api)
                const rawName = toolCallObj.name || ''
                const toolName = resolveToolName(rawName, knownToolNames) || rawName
                const toolArgs = toolCallObj.arguments || {}
                const toolId = 'call_' + randomUUID()

                await s.write(openai.formatStreamToolCall(
                  { id: toolId, name: toolName, arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs) },
                  request.model,
                  emittedToolCallCount,
                ))
                emittedToolCallCount++
                toolCallDone = true // Truncate any text after tool calls
              } catch {
                if (emittedToolCallCount === 0) {
                  await s.write(openai.formatStreamChunk(doubleMarkdown(TOOL_START + toolJsonStr + TOOL_END), request.model))
                }
              }

              insideTool = false
              contentEmitBuffer = contentEmitBuffer.substring(endIdx + TOOL_END.length)
            }
          }
        } catch (err: any) {
          log('error', `Stream error: ${err.message}`)
          await s.write(`data: ${JSON.stringify({ error: { message: 'Stream interrupted' } })}\n\n`)
        }
      })
    }

    try {
      let content = ''
      let thinking = ''
      for await (const event of orchestrate(request, pool, config)) {
        if (event.error) {
          return c.json({ error: { message: event.error, type: 'server_error' } }, 502)
        }
        if (event.thinking) {
          thinking += event.thinking
        } else {
          content += event.token
        }
      }
      return c.json(openai.formatResponse(request.model, doubleMarkdown(content), thinking))
    } catch (err: any) {
      log('error', `Request failed: ${err.message}`)
      return c.json({ error: { message: 'Backend error: ' + err.message, type: 'server_error' } }, 502)
    }
  })

  return router
}
