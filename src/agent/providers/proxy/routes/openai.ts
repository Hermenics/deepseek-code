import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { validateRequest } from '../services/validator.js'
import * as openai from '../formatters/openai.js'
import { orchestrate } from '../services/orchestrator.js'
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
          let insideTool = false
          let emittedToolCallCount = 0
          let contentEmitBuffer = ''
          let finalUsage: { promptTokens: number; completionTokens: number } | undefined

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
              if (!insideTool && contentEmitBuffer) {
                await s.write(openai.formatStreamChunk(doubleMarkdown(contentEmitBuffer), request.model))
                contentEmitBuffer = ''
              }
              await s.write(openai.formatStreamEnd(emittedToolCallCount > 0 ? 'tool_calls' : 'stop', finalUsage))
              break
            }

            contentEmitBuffer += event.token

            while (contentEmitBuffer.length > 0) {
              if (!insideTool) {
                const startIdx = contentEmitBuffer.indexOf(TOOL_START)
                if (startIdx !== -1) {
                  const textBefore = contentEmitBuffer.substring(0, startIdx)
                  if (textBefore && emittedToolCallCount === 0 && hasCompleteMarkdown(textBefore)) {
                    await s.write(openai.formatStreamChunk(doubleMarkdown(textBefore), request.model))
                  }
                  insideTool = true
                  contentEmitBuffer = contentEmitBuffer.substring(startIdx + TOOL_START.length)
                  continue
                }

                let flushIndex = contentEmitBuffer.length
                for (let i = 1; i <= TOOL_START.length; i++) {
                  if (contentEmitBuffer.endsWith(TOOL_START.substring(0, i))) {
                    flushIndex = contentEmitBuffer.length - i
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

              const endIdx = contentEmitBuffer.indexOf(TOOL_END)
              if (endIdx === -1) break

              const toolJsonStr = contentEmitBuffer.substring(0, endIdx).trim()
              try {
                const toolCallObj = JSON.parse(toolJsonStr) as { name?: string; arguments?: unknown }
                const toolName = toolCallObj.name || ''
                const toolArgs = toolCallObj.arguments || {}
                const toolId = 'call_' + randomUUID()

                await s.write(openai.formatStreamToolCall(
                  { id: toolId, name: toolName, arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs) },
                  request.model,
                  emittedToolCallCount,
                ))
                emittedToolCallCount++
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
