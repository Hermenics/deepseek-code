import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { validateRequest } from '../services/validator.js'
import * as anthropic from '../formatters/anthropic.js'
import { orchestrate } from '../services/orchestrator.js'
import { log } from '../config.js'
import { parseToolResponses } from '../tools/prompt-emulation.js'
import { isInsideCodeFence } from '../services/output-sanitizer.js'
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
          let contentIndex = 0
          let textBuffer = ''
          let toolCallDetected = false

          for await (const event of orchestrate(request, pool, config)) {
            if (event.error) {
              await s.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: event.error } })}\n\n`)
              break
            }
            if (event.thinking) {
              await s.write(anthropic.formatThinkingBlock(event.thinking))
              contentIndex = 1
            } else if (event.done) {
              // Stream ended — check accumulated buffer for tool calls
              const toolCalls = parseToolResponses(textBuffer)

              if (toolCalls.length > 0) {
                // Find where the first tool call starts in the text
                const firstToolMarkers = ['<tool_call>', '{"tool_use"', '<|DSML|', '<|tool_calls_begin|>']
                let firstToolPos = textBuffer.length
                for (const marker of firstToolMarkers) {
                  const pos = textBuffer.indexOf(marker)
                  if (pos !== -1 && pos < firstToolPos && !isInsideCodeFence(textBuffer, pos)) {
                    firstToolPos = pos
                  }
                }

                // Emit text before the first tool call (if any)
                const textBefore = textBuffer.slice(0, firstToolPos).trim()
                if (textBefore) {
                  await s.write(anthropic.formatContentBlockStart(contentIndex))
                  await s.write(anthropic.formatStreamChunk(textBefore, contentIndex))
                  await s.write(anthropic.formatStreamEnd(contentIndex))
                  contentIndex++
                }

                // Emit each tool call as a tool_use content block
                for (const tool of toolCalls) {
                  await s.write(anthropic.formatToolUseBlockStart(contentIndex, tool.id, tool.name))
                  await s.write(anthropic.formatToolUseBlockDelta(contentIndex, JSON.stringify(tool.arguments)))
                  await s.write(anthropic.formatToolUseBlockStop(contentIndex))
                  contentIndex++
                }

                // End with message_delta stop_reason=tool_use and message_stop
                await s.write(anthropic.formatMessageDelta('tool_use'))
                await s.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
              } else {
                // No tool calls — emit all accumulated text
                if (textBuffer) {
                  await s.write(anthropic.formatContentBlockStart(contentIndex))
                  await s.write(anthropic.formatStreamChunk(textBuffer, contentIndex))
                  await s.write(anthropic.formatStreamEnd(contentIndex))
                }
              }
            } else {
              // Accumulate tokens into buffer
              textBuffer += event.token

              // Check for tool call patterns mid-stream to set flag (for logging/debugging)
              if (!toolCallDetected) {
                const markers = ['<tool_call>', '{"tool_use"', '<|DSML|', '<|tool_calls_begin|>']
                for (const marker of markers) {
                  const pos = textBuffer.indexOf(marker)
                  if (pos !== -1 && !isInsideCodeFence(textBuffer, pos)) {
                    toolCallDetected = true
                    break
                  }
                }
              }
            }
          }
        } catch (err: any) {
          log('error', `Stream error: ${err.message}`)
          await s.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: 'Stream interrupted' } })}\n\n`)
        }
      })
    } else {
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
    }
  })

  return router
}
