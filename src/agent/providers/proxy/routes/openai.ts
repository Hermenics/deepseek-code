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
          let suppressAll = false
          let flushed = false
          const pendingChunks: string[] = []

          for await (const event of orchestrate(request, pool, config)) {
            if (event.error) {
              await s.write(`data: ${JSON.stringify({ error: { message: event.error } })}\n\n`)
              break
            }
            if (event.done) {
              const toolCall = openai.parseToolCall(accumulated)
              if (toolCall) {
                await s.write(openai.formatStreamToolCall(toolCall, request.model))
              } else if (!flushed && pendingChunks.length > 0) {
                for (const chunk of pendingChunks) {
                  await s.write(openai.formatStreamChunk(chunk, request.model))
                }
              }
              await s.write(openai.formatStreamEnd())
            } else {
              accumulated += event.token
              const looksLikeTool = accumulated.includes('tool_use') || accumulated.includes('DSML') || accumulated.includes('<tool_call>') || accumulated.trimStart().startsWith('```') || accumulated.trimStart().startsWith('{"')
              if (looksLikeTool) {
                suppressAll = true
              }
              if (!suppressAll) {
                if (accumulated.length < 50) {
                  pendingChunks.push(event.token)
                } else {
                  if (!flushed) {
                    for (const chunk of pendingChunks) {
                      await s.write(openai.formatStreamChunk(chunk, request.model))
                    }
                    pendingChunks.length = 0
                    flushed = true
                  }
                  await s.write(openai.formatStreamChunk(event.token, request.model))
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
      for await (const event of orchestrate(request, pool, config)) {
        if (event.error) {
          return c.json({ error: { message: event.error, type: 'server_error' } }, 502)
        }
        content += event.token
      }
      return c.json(openai.formatResponse(request.model, content))
    } catch (err: any) {
      log('error', `Request failed: ${err.message}`)
      return c.json({ error: { message: 'Backend error: ' + err.message, type: 'server_error' } }, 502)
    }
  })

  return router
}
