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
          let accumulated = ''

          for await (const event of orchestrate(request, pool, config)) {
            if (event.error) {
              await s.write(`data: ${JSON.stringify({ error: { message: event.error } })}\n\n`)
              await s.write(openai.formatStreamEnd())
              break
            }

            // Emit thinking/reasoning as a delta with reasoning_content
            if (event.thinking) {
              await s.write(openai.formatStreamReasoning(event.thinking, request.model))
              continue
            }

            if (event.done) {
              // Response complete — check if it's a tool call or normal text
              const toolCalls = openai.parseToolCalls(accumulated)
              if (toolCalls.length > 0) {
                // Entire response was a tool call batch — send all tool_calls deltas
                for (const [index, toolCall] of toolCalls.entries()) {
                  await s.write(openai.formatStreamToolCall(toolCall, request.model, index))
                }
              } else if (accumulated) {
                // Normal text response — flush remaining buffered text
                await s.write(openai.formatStreamChunk(doubleMarkdown(accumulated), request.model))
              }
              await s.write(openai.formatStreamEnd())
            } else {
              accumulated += event.token

              // Streaming strategy: prioritize responsiveness while still detecting tool calls.
              // The Agent has a fallback parser, so even if we flush a tool call as text,
              // it will still be detected and executed. This lets us be aggressive with streaming.
              const trimmedStart = accumulated.trimStart()
              const hasToolMarker = accumulated.includes('"tool_use"') ||
                accumulated.includes('DSML') ||
                accumulated.includes('<tool_call>')

              if (hasToolMarker) {
                // Strong tool signal — buffer until done (handled above)
              } else if (trimmedStart.startsWith('{') || trimmedStart.startsWith('```')) {
                // Could be a tool call — buffer briefly to check for markers
                // Tool calls are typically < 200 chars, so if we exceed that without
                // seeing a marker, it's likely not a tool call
                if (accumulated.length >= 200) {
                  await s.write(openai.formatStreamChunk(accumulated, request.model))
                  accumulated = ''
                }
              } else {
                // Text content — flush only when markdown markers are balanced
                if (hasCompleteMarkdown(accumulated)) {
                  await s.write(openai.formatStreamChunk(doubleMarkdown(accumulated), request.model))
                  accumulated = ''
                } else if (accumulated.length > 500) {
                  // Safety valve: don't buffer forever
                  await s.write(openai.formatStreamChunk(doubleMarkdown(accumulated), request.model))
                  accumulated = ''
                }
              }
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
