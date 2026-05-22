import { getActivePage } from './playwright.js'

export interface DeepSeekHeaders {
  headers: Record<string, string>
  chatSessionId: string
  parentMessageId: number | null
}

const sessionParents = new Map<string, number | null>()

export function updateSessionParent(sessionId: string, parentId: number | null): void {
  sessionParents.set(sessionId, parentId)
}

export function getSessionParent(sessionId: string): number | null {
  return sessionParents.get(sessionId) ?? null
}

function buildTestHeaders(): DeepSeekHeaders {
  return {
    headers: { accept: 'text/event-stream' },
    chatSessionId: 'test-session',
    parentMessageId: null,
  }
}

export async function getDeepSeekHeaders(forceNew = false): Promise<DeepSeekHeaders> {
  // Test environment: return mock headers
  if (process.env.NODE_ENV === 'test') return buildTestHeaders()

  const page = getActivePage()
  if (!page) {
    throw new Error('Playwright not initialized. Start the OAuth proxy before sending requests.')
  }

  // Navigate to deepseek home if needed
  const currentUrl = page.url()
  const isOnDeepSeek = currentUrl.includes('chat.deepseek.com')
  const isOnSpecificChat = isOnDeepSeek && /\/chat\//.test(currentUrl)

  if (!isOnDeepSeek || forceNew || isOnSpecificChat) {
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' })
  }

  // Wait for textarea (confirms user is logged in)
  await page.waitForSelector('textarea', { timeout: 30000 }).catch(() => {
    throw new Error('Timeout waiting for chat input. Are you logged in to DeepSeek?')
  })

  // Intercept the real API request to extract PoW headers
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.unroute('**/api/v0/chat/completion').catch(() => {})
      reject(new Error('Timeout waiting for PoW headers from DeepSeek'))
    }, 60000)

    const routeHandler = async (route: any, request: any) => {
      clearTimeout(timeout)

      const reqHeaders = request.headers()
      let chatSessionId = ''
      let parentMessageId: number | null = null

      const postData = request.postData()
      if (postData) {
        try {
          const payload = JSON.parse(postData)
          if (payload.chat_session_id) chatSessionId = payload.chat_session_id
          if (payload.parent_message_id !== undefined) parentMessageId = payload.parent_message_id
        } catch {
          // ignore parse error
        }
      }

      const headers: Record<string, string> = {
        'x-ds-pow-response': reqHeaders['x-ds-pow-response'] || '',
        'x-hif-dliq':        reqHeaders['x-hif-dliq'] || '',
        'x-hif-leim':        reqHeaders['x-hif-leim'] || '',
        'authorization':     reqHeaders['authorization'] || '',
        'cookie':            reqHeaders['cookie'] || '',
        'accept':            'text/event-stream',
        'origin':            'https://chat.deepseek.com',
        'referer':           'https://chat.deepseek.com/',
      }

      // Abort to avoid polluting chat history
      await route.abort('aborted').catch(() => {})
      await page.unroute('**/api/v0/chat/completion', routeHandler).catch(() => {})

      resolve({ headers, chatSessionId, parentMessageId })
    }

    // Register route interceptor then trigger PoW generation
    page.route('**/api/v0/chat/completion', routeHandler).then(() => {
      page.fill('textarea', 'a').then(() => {
        page.keyboard.press('Enter').catch(() => {})
      }).catch(() => {})
    }).catch((err: Error) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}
