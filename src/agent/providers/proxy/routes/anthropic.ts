import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { validateRequest } from '../services/validator.js'
import * as anthropic from '../formatters/anthropic.js'
import { orchestrate } from '../services/orchestrator.js'
import { log } from '../config.js'
import type { PagePool } from '../browser/pool.js'
import type { ProxyConfig } from '../types/index.js'

export function createAnthropicRouter(pool: PagePool, config: ProxyConfig) {
  const router = new Hono()

  router.post('/v1/messages', async (c) => {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400)
    }

    const error = validateRequest(body)
    if (error) return c.json({ error: { message: error, type: 'invalid_request_error' } }, 400)

    const request = anthropic.parseRequest(body)
    log('info', `Anthropic request: model=${request.model} stream=${request.stream} messages=${request.messages.length}`)

    if (request.stream) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')
        c.header('Connection', 'keep-alive')
        try {
          await s.write(anthropic.formatStreamStart(request.model))
          let textBlockStarted = false
          let contentIndex = 0

          for await (const event of orchestrate(request, pool, config)) {
            if (event.error) {
              await s.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: event.error } })}\n\n`)
              break
            }
            if (event.thinking) {
              await s.write(anthropic.formatThinkingBlock(event.thinking))
              contentIndex = 1
            } else if (event.done) {
              if (textBlockStarted) {
                await s.write(anthropic.formatStreamEnd())
              }
            } else {
              if (!textBlockStarted) {
                await s.write(anthropic.formatContentBlockStart(contentIndex))
                textBlockStarted = true
              }
              await s.write(anthropic.formatStreamChunk(event.token, contentIndex))
            }
          }
        } catch (err: any) {
          log('error', `Stream error: ${err.message}`)
          await s.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: 'Stream interrupted' } })}\n\n`)
        }
      })
    }

    try {
      let content = ''
      let thinking = ''
      for await (const event of orchestrate(request, pool, config)) {
        if (event.error) {
          return c.json({ type: 'error', error: { type: 'api_error', message: event.error } }, 502)
        }
        if (event.thinking) thinking = event.thinking
        else content += event.token
      }
      return c.json(anthropic.formatResponse(request.model, content, thinking))
    } catch (err: any) {
      log('error', `Request failed: ${err.message}`)
      return c.json({ type: 'error', error: { type: 'api_error', message: 'Backend error: ' + err.message } }, 502)
    }
  })

  return router
}
