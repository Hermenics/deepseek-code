import { type Page } from 'playwright'
import { getActivePage } from './playwright.js'
import { withRetry } from '../services/retry.js'

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

const CACHE_TTL_MS = 120_000

let cachedHeaders: { headers: Record<string, string>; chatSessionId: string; timestamp: number } | null = null
let pendingRequest: Promise<DeepSeekHeaders> | null = null

export async function getDeepSeekHeaders(forceNew = false): Promise<DeepSeekHeaders> {
  // Test environment: return mock headers
  if (process.env.NODE_ENV === 'test') return buildTestHeaders()

  // Return cached headers if still fresh (and not forcing new session)
  if (!forceNew && cachedHeaders && (Date.now() - cachedHeaders.timestamp) < CACHE_TTL_MS) {
    // Background refresh: when cache age > 80% of TTL, trigger non-blocking refresh
    const cacheAge = Date.now() - cachedHeaders.timestamp
    if (cacheAge > CACHE_TTL_MS * 0.8 && !pendingRequest) {
      // Background refresh participates in the mutex so a concurrent foreground
      // request waits for the same Promise instead of spawning a second browser intercept.
      pendingRequest = withRetry(() => refreshSessionAndHeaders(), { maxRetries: 2, baseDelay: 2000 })
        .then((result) => {
          cachedHeaders = { headers: result.headers, chatSessionId: result.chatSessionId, timestamp: Date.now() }
          return result
        })
        .catch(() => {
          // Ignore background refresh failures — return current cache so callers don't fail
          if (!cachedHeaders) throw new Error('Cache expired during background refresh')
          return {
            headers: cachedHeaders.headers,
            chatSessionId: cachedHeaders.chatSessionId,
            parentMessageId: getSessionParent(cachedHeaders.chatSessionId),
          }
        })
        .finally(() => { pendingRequest = null })
      // Do NOT await — return the cached value immediately to the current caller
    }

    return {
      headers: cachedHeaders.headers,
      chatSessionId: cachedHeaders.chatSessionId,
      parentMessageId: getSessionParent(cachedHeaders.chatSessionId),
    }
  }

  // Mutex: if another request is already fetching headers, wait for it
  // forceNew bypasses the mutex — a stale pending request must not block a forced re-auth
  if (pendingRequest && !forceNew) {
    return pendingRequest
  }

  pendingRequest = withRetry(() => fetchHeadersFromBrowser(forceNew), {
    maxRetries: 2,
    baseDelay: 2000,
  })
  try {
    const result = await pendingRequest
    return result
  } finally {
    pendingRequest = null
  }
}

/**
 * Detect if the page is showing a WAF (Web Application Firewall) challenge
 * instead of the actual DeepSeek chat interface.
 */
async function isWafChallenge(page: Page): Promise<boolean> {
  const content = await page.content()
  const lowerContent = content.toLowerCase()
  return (
    lowerContent.includes('confirm you are human') ||
    lowerContent.includes('security check') ||
    lowerContent.includes('checking your browser') ||
    lowerContent.includes('just a moment') ||
    lowerContent.includes('challenge-platform')
  )
}

/**
 * Wait for a WAF challenge to auto-resolve. The challenge JS often solves
 * itself after a few seconds when cookies/tokens are partially valid.
 * Returns true if the challenge resolved, false if still blocked.
 */
async function waitForWafResolution(page: Page, timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(2000)
    if (!(await isWafChallenge(page))) {
      return true
    }
  }
  return false
}

/**
 * Refresh session by navigating to DeepSeek to keep WAF token fresh,
 * then fetch new PoW headers. Used by background refresh.
 */
async function refreshSessionAndHeaders(): Promise<DeepSeekHeaders> {
  const { initPlaywright } = await import('./playwright.js')
  await initPlaywright(true)

  const page = getActivePage()
  if (!page) {
    throw new Error('Failed to initialize Playwright browser context.')
  }

  // Navigate to keep WAF cookie alive
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' })

  // If WAF challenge appears during refresh, wait for it to auto-resolve
  if (await isWafChallenge(page)) {
    const resolved = await waitForWafResolution(page, 30000)
    if (!resolved) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
    }
  }

  // Now fetch fresh headers via the normal flow (skip navigation since we just did it)
  return fetchHeadersFromBrowser(false)
}

/**
 * Check whether the current browser session has a valid DeepSeek login.
 * Reads userToken from localStorage, or falls back to checking the URL for
 * a redirect to the sign-in page.
 */
async function checkSessionValid(page: Page): Promise<boolean> {
  try {
    // Primary check: URL must be on deepseek and not on a login/sign-in redirect
    const url = page.url()
    if (url.includes('sign_in') || url.includes('login')) return false
    if (!url.includes('chat.deepseek.com')) return false

    // Secondary check: userToken present in localStorage
    const userToken = await page.evaluate(() => {
      try {
        return localStorage.getItem('userToken')
      } catch {
        return null
      }
    })
    return !!userToken
  } catch {
    return false
  }
}

async function fetchHeadersFromBrowser(forceNew: boolean): Promise<DeepSeekHeaders> {
  // Lazy init: start Playwright on first header request if not already running
  const { initPlaywright } = await import('./playwright.js')
  await initPlaywright(true)

  const page = getActivePage()
  if (!page) {
    throw new Error('Failed to initialize Playwright browser context.')
  }

  // Navigate to deepseek home if needed
  const currentUrl = page.url()
  const isOnDeepSeek = currentUrl.includes('chat.deepseek.com')
  const isOnSpecificChat = isOnDeepSeek && /\/chat\//.test(currentUrl)

  if (!isOnDeepSeek || forceNew || isOnSpecificChat) {
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' })
  }

  // Check for WAF challenge before waiting for textarea
  if (await isWafChallenge(page)) {
    // Wait for the WAF challenge JS to auto-resolve
    const resolved = await waitForWafResolution(page, 30000)
    if (!resolved) {
      // Try refreshing — the WAF token from the challenge JS might now be valid
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)

      if (await isWafChallenge(page)) {
        throw new Error(
          'WAF challenge detected. The browser session is blocked by DeepSeek\'s security. ' +
          'Please run \'deepseek login\' to re-authenticate.'
        )
      }
    }
  }

  // Wait for textarea — React can take 2-5 seconds to mount after networkidle,
  // so we give it 45 seconds before falling back to a session check + reload.
  const textareaFound = await page.waitForSelector('textarea', { timeout: 45000 })
    .then(() => true)
    .catch(() => false)

  if (!textareaFound) {
    // Check if redirected to sign-in page (OAuth session expired)
    const url = page.url()
    if (url.includes('sign_in') || url.includes('login')) {
      throw new Error("OAuth session expired. Run 'deepseek login' to re-authenticate.")
    }

    // Check if WAF challenge appeared after navigation
    const content = await page.content()
    const lowerContent = content.toLowerCase()
    if (lowerContent.includes('confirm you are human') || lowerContent.includes('security check')) {
      throw new Error("WAF challenge detected. Run 'deepseek login' to re-authenticate.")
    }

    // Validate session — if valid, React may just need a reload to mount
    const sessionValid = await checkSessionValid(page)
    if (sessionValid) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      // Verify WAF did not trigger after reload before waiting for textarea
      if (await isWafChallenge(page)) {
        await waitForWafResolution(page, 30000)
      }
      const textareaFoundAfterReload = await page.waitForSelector('textarea', { timeout: 45000 })
        .then(() => true)
        .catch(() => false)

      if (!textareaFoundAfterReload) {
        throw new Error('Timeout waiting for chat input after reload. DeepSeek UI did not mount.')
      }
    } else {
      throw new Error("OAuth session expired. Run 'deepseek login' to re-authenticate.")
    }
  }

  // Intercept the real API request to extract PoW headers
  return new Promise((resolve, reject) => {
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      page.unroute('**/api/v0/chat/completion', routeHandler).catch(() => {})
      reject(new Error('Timeout waiting for PoW headers from DeepSeek'))
    }, 60000)

    const routeHandler = async (route: any, request: any) => {
      // Guard against being called after we already resolved/rejected
      if (settled) {
        route.abort('aborted').catch(() => {})
        return
      }
      // Set settled FIRST before any await to prevent double-settle with the timeout
      settled = true
      clearTimeout(timeout)

      try {
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

        // Abort the intercepted request before unrouting to prevent context teardown issues
        await Promise.race([
          route.abort('aborted'),
          new Promise<void>((res) => setTimeout(res, 3000)),
        ]).catch(() => {})

        // Unroute only after abort completes (or times out)
        await page.unroute('**/api/v0/chat/completion', routeHandler).catch(() => {})

        cachedHeaders = { headers, chatSessionId, timestamp: Date.now() }
        resolve({ headers, chatSessionId, parentMessageId })
      } catch (err) {
        // Something went wrong inside the handler — clean up and reject
        await route.abort('aborted').catch(() => {})
        await page.unroute('**/api/v0/chat/completion', routeHandler).catch(() => {})
        reject(err)
      }
    }

    // Register route interceptor then trigger PoW generation
    page.route('**/api/v0/chat/completion', routeHandler).then(() => {
      page.fill('textarea', 'a').then(() => {
        page.keyboard.press('Enter').catch(() => {})
      }).catch(() => {})
    }).catch((err: Error) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}
