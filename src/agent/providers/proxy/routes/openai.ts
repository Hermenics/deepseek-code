import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { validateRequest } from '../services/validator.js'
import * as openai from '../formatters/openai.js'
import { orchestrate } from '../services/orchestrator.js'
import { log } from '../config.js'
import type { PagePool } from '../browser/pool.js'
import type { ProxyConfig } from '../types/index.js'

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
              break
            }

            // Emit thinking/reasoning as a delta with reasoning_content
            if (event.thinking) {
              await s.write(openai.formatStreamReasoning(event.thinking, request.model))
              continue
            }

            if (event.done) {
              // Response complete — check if it's a tool call or normal text
              const toolCall = openai.parseToolCall(accumulated)
              if (toolCall) {
                // Entire response was a tool call — send as tool_calls delta
                await s.write(openai.formatStreamToolCall(toolCall, request.model))
              } else if (accumulated) {
                // Normal text response — flush remaining buffered text
                await s.write(openai.formatStreamChunk(accumulated, request.model))
              }
              await s.write(openai.formatStreamEnd())
            } else {
              accumulated += event.token

              // Determine if this could be a tool call based on content patterns.
              // Tool calls: start with { or ```, contain "tool_use", DSML, or <tool_call>
              // Text responses: start with a letter, word, or markdown heading
              const trimmedStart = accumulated.trimStart()
              const startsLikeJson = trimmedStart.startsWith('{') || trimmedStart.startsWith('```')
              const containsToolMarker = accumulated.includes('"tool_use"') ||
                accumulated.includes('DSML') ||
                accumulated.includes('<tool_call>')

              const couldBeTool = accumulated.length < 2000 && (startsLikeJson || containsToolMarker)

              if (!couldBeTool) {
                // Definitely not a tool call — stream immediately for responsiveness
                await s.write(openai.formatStreamChunk(accumulated, request.model))
                accumulated = ''
              }
              // If it could be a tool call, keep buffering until done or > 2000 chars
              // (at which point it's too long to be a tool call, so flush)
              else if (accumulated.length >= 2000) {
                await s.write(openai.formatStreamChunk(accumulated, request.model))
                accumulated = ''
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
      return c.json(openai.formatResponse(request.model, content, thinking))
    } catch (err: any) {
      log('error', `Request failed: ${err.message}`)
      return c.json({ error: { message: 'Backend error: ' + err.message, type: 'server_error' } }, 502)
    }
  })

  return router
}
