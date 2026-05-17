import { randomUUID } from 'node:crypto'
import type { ProxyRequest, TokenEvent } from '../types/index.js'
import type { ProxyConfig } from '../types/index.js'
import { PagePool } from '../browser/pool.js'
import { resolveModel, isThinkingModel } from './model-resolver.js'
import { selectModel, typeMessage, submitMessage, startNewChat, saveDebugScreenshot } from '../browser/actions.js'
import { observeResponse, captureThinking } from '../browser/observer.js'
import { getCached, setCache } from './cache.js'
import { logHistory } from './history.js'
import { withRetry } from './retry.js'
import { log } from '../config.js'
import { filterMessages } from './message-filter.js'

interface ActiveSession {
  pageId: string
  model: string
  messageCount: number
}

let currentSession: ActiveSession | null = null

export async function* orchestrate(
  request: ProxyRequest,
  pool: PagePool,
  config: ProxyConfig
): AsyncGenerator<TokenEvent> {
  const conversationId = request.conversationId || randomUUID()

  if (!request.stream) {
    const cached = getCached(request.model, request.messages, config.cacheTtl)
    if (cached) {
      log('debug', 'Cache hit', { model: request.model })
      yield { token: cached, done: true }
      return
    }
  }

  const uiModel = resolveModel(request.model)
  const clientMsgCount = request.messages.length
  const needsNewChat = !currentSession ||
    currentSession.model !== request.model ||
    clientMsgCount < currentSession.messageCount

  const pooled = await pool.acquire()
  log('debug', `Page acquired: ${pooled.id}`)

  try {
    if (needsNewChat) {
      log('info', currentSession ? `Model changed (${currentSession.model} → ${request.model}) → new chat` : 'New session → new chat')

      const currentUrl = pooled.page.url()
      const alreadyOnDeepSeek = currentUrl.includes('chat.deepseek.com') && !currentUrl.includes('sign_in')

      if (!alreadyOnDeepSeek) {
        await withRetry(async () => {
          await pooled.page.goto('https://chat.deepseek.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          })
        })
        const url = pooled.page.url()
        if (url.includes('sign_in') || url.includes('login')) {
          yield { token: '', done: true, error: 'Session expired. Run "deepseek logout" then log in again.' }
          return
        }
      }

      await saveDebugScreenshot(pooled.page, 'before-new-chat', config.logLevel)
      await startNewChat(pooled.page)
      await saveDebugScreenshot(pooled.page, 'after-new-chat', config.logLevel)
      await pooled.page.waitForSelector('textarea', { timeout: 20000 })
      await selectModel(pooled.page, uiModel)

      const cleanMessages = filterMessages(request.messages)
      const prompt = formatFullHistory(cleanMessages)
      log('debug', `Sending full history (${prompt.length} chars, ${cleanMessages.length}/${request.messages.length} msgs after filter)`)

      await typeMessage(pooled.page, prompt)
      await submitMessage(pooled.page)

      const useThinking = isThinkingModel(request.model)
      const effectiveTimeout = useThinking ? Math.max(config.responseTimeout, 120000) : config.responseTimeout

      let fullResponse = ''
      for await (const event of observeResponse(pooled.page, effectiveTimeout, 0)) {
        fullResponse += event.token
        yield event
        if (event.done) break
      }

      currentSession = { pageId: pooled.id, model: request.model, messageCount: request.messages.length }

      if (fullResponse) {
        setCache(request.model, request.messages, fullResponse)
        logHistory(request.model, conversationId, request.messages, fullResponse)
      }
    } else {
      const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user')
      if (!lastUserMsg) {
        yield { token: '', done: true, error: 'No user message found' }
        return
      }

      log('debug', `Continuing chat, sending last message (${lastUserMsg.content.length} chars)`)

      try {
        await pooled.page.waitForSelector('textarea', { timeout: 5000 })
      } catch {
        log('warn', 'Textarea not found in existing session, creating new chat')
        currentSession = null
        yield* orchestrate(request, pool, config)
        return
      }

      const baselineCount = await pooled.page.locator('.ds-markdown').count()

      await typeMessage(pooled.page, lastUserMsg.content)
      await submitMessage(pooled.page)

      const useThinkingCont = isThinkingModel(request.model)
      const effectiveTimeoutCont = useThinkingCont ? Math.max(config.responseTimeout, 120000) : config.responseTimeout

      let fullResponse = ''
      for await (const event of observeResponse(pooled.page, effectiveTimeoutCont, baselineCount)) {
        fullResponse += event.token
        yield event
        if (event.done) break
      }

      currentSession!.messageCount = request.messages.length

      if (fullResponse) {
        setCache(request.model, request.messages, fullResponse)
        logHistory(request.model, conversationId, request.messages, fullResponse)
      }
    }
  } catch (err: any) {
    log('error', `Orchestration failed: ${err.message}`)
    currentSession = null

    if (err.message.includes('crash') || err.message.includes('closed') || err.message.includes('Target')) {
      log('warn', `Replacing crashed page: ${pooled.id}`)
      await pool.replacePage(pooled.id)
      yield { token: '', done: true, error: `Browser page crashed: ${err.message}` }
      return
    }

    yield { token: '', done: true, error: err.message }
  } finally {
    pool.release(pooled.id)
  }
}

function formatFullHistory(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => {
      if (m.role === 'system') return `[System] ${m.content}`
      if (m.role === 'assistant') return `[Assistant] ${m.content}`
      return m.content
    })
    .join('\n\n')
}
