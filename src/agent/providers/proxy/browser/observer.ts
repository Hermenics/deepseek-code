import type { Page } from 'playwright'
import type { TokenEvent } from '../types/index.js'
import { log } from '../config.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'

const RESPONSE_SELECTOR = '.ds-markdown'
const RESPONSE_SELECTOR_FALLBACKS = [
  '.ds-markdown',
  '[class*="markdown"]',
  '[class*="message-content"]',
  '[class*="chat-message"]',
  '[class*="response"]',
  '[class*="artifact"]',
  '[class*="result-content"]',
  '[class*="code-result"]',
  '[class*="assistant-message"]',
  '[class*="chat-content"]',
  '.dad65929',
]
const THINKING_SELECTORS = [
  '.ds-thinking-content',
  '[class*="thinking"]',
  '[class*="reason"]',
  '.thought-content',
]

export async function captureThinking(page: Page, timeout: number): Promise<string> {
  const combinedSelector = THINKING_SELECTORS.join(', ')

  try {
    await page.waitForSelector(combinedSelector, { timeout: 10000 })
    log('debug', 'Thinking container found')
  } catch {
    return ''
  }

  const deadline = Date.now() + timeout
  let captured = ''
  let stable = 0

  while (Date.now() < deadline && stable < 8) {
    await page.waitForTimeout(500)

    const text = await page.evaluate((selectors) => {
      for (const sel of selectors.split(', ')) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0) {
          const last = els[els.length - 1]
          const t = last.textContent || (last as HTMLElement).innerText || ''
          if (t.trim()) return t.trim()
        }
      }
      return ''
    }, combinedSelector).catch(() => '')

    if (text && text.length > captured.length) {
      captured = text
      stable = 0
    } else if (text && text.length === captured.length) {
      const thinkingDone = await page.evaluate((responseSel) => {
        const responseEls = document.querySelectorAll(responseSel)
        const hasNewResponse = responseEls.length > 0 &&
          (responseEls[responseEls.length - 1].textContent || '').trim().length > 0
        const noStopBtn = !document.querySelector('[class*="stop"]')
        return hasNewResponse || noStopBtn
      }, RESPONSE_SELECTOR).catch(() => false)

      if (thinkingDone) {
        log('debug', 'Thinking phase ended (response started or stop button gone)')
        break
      }
      stable++
    } else if (!text && captured.length > 0) {
      log('debug', 'Thinking block collapsed, using accumulated text')
      break
    } else {
      stable++
    }
  }

  if (captured) {
    log('debug', `Thinking captured (${captured.length} chars)`)
  }
  return captured
}

export async function* observeResponse(page: Page, timeout: number, knownCount?: number): AsyncGenerator<TokenEvent> {
  const deadline = Date.now() + timeout

  // Try to find which selector is active on this page
  let activeSelector = RESPONSE_SELECTOR
  const initialCount = knownCount ?? await page.locator(RESPONSE_SELECTOR).count()

  // Capture baselines for ALL selectors to enable proper fallback detection
  const selectorBaselines = new Map<string, number>()
  for (const sel of RESPONSE_SELECTOR_FALLBACKS) {
    selectorBaselines.set(sel, await page.locator(sel).count())
  }

  log('debug', `Waiting for response (baseline: ${initialCount} elements, selector: ${activeSelector})`)

  // Check immediately before entering the wait loop — response may already be there
  let newElementAppeared = (await page.locator(activeSelector).count()) > initialCount
  if (newElementAppeared) {
    log('debug', `Response already present before loop (selector: ${activeSelector})`)
  }

  for (let i = 0; !newElementAppeared && i < 240 && Date.now() < deadline; i++) {
    // Try primary selector first
    const currentCount = await page.locator(activeSelector).count()
    if (currentCount > initialCount) {
      newElementAppeared = true
      log('debug', `New response element appeared (${currentCount} total, selector: ${activeSelector})`)
      break
    }

    // Every 10 iterations, try fallback selectors against their own baselines
    if (i > 0 && i % 10 === 0) {
      for (const sel of RESPONSE_SELECTOR_FALLBACKS) {
        if (sel === activeSelector) continue
        const baseline = selectorBaselines.get(sel) || 0
        const count = await page.locator(sel).count()
        if (count > baseline) {
          log('debug', `Fallback selector matched: ${sel} (was ${baseline}, now ${count})`)
          activeSelector = sel
          newElementAppeared = true
          break
        }
      }
      if (newElementAppeared) break
    }

    // Every 20 iterations, check for auth redirect
    if (i > 0 && i % 20 === 0) {
      const currentUrl = page.url()
      if (currentUrl.includes('sign_in') || currentUrl.includes('login')) {
        log('error', 'Auth redirect detected during response wait')
        yield { token: '', done: true, error: 'Session expired. Run "deepseek logout" then log in again.' }
        return
      }
    }

    // After 30 iterations (15s), try position-based detection as last resort
    if (i === 30 || i === 60 || i === 120) {
      const positionDetected = await page.evaluate((baseline) => {
        const containers = document.querySelectorAll('[class*="conversation"], [class*="chat-messages"], [class*="message-list"], main [class*="overflow"]')
        for (const container of Array.from(containers)) {
          const messages = container.querySelectorAll(':scope > div')
          if (messages.length > baseline) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg && lastMsg.textContent && lastMsg.textContent.trim().length > 10) {
              return { found: true, className: lastMsg.className || 'unknown' }
            }
          }
        }

        const articles = document.querySelectorAll('[role="article"], [data-testid*="message"], [class*="bubble"]')
        if (articles.length > baseline) {
          return { found: true, className: (articles[articles.length - 1] as HTMLElement).className || 'unknown' }
        }

        return { found: false, className: '' }
      }, initialCount).catch(() => ({ found: false, className: '' }))

      if (positionDetected.found) {
        log('debug', `Position-based detection found response (class: ${positionDetected.className})`)
        if (positionDetected.className && positionDetected.className !== 'unknown') {
          const firstClass = positionDetected.className.split(' ')[0]
          if (firstClass) {
            activeSelector = '.' + firstClass
            newElementAppeared = true
            break
          }
        }

        activeSelector = '[class*="markdown"], [class*="message-content"], [class*="chat-content"]'
        newElementAppeared = true
        break
      }
    }

    const isThinking = await page.evaluate(() => {
      return !!document.querySelector('[class*="thinking"]') ||
             !!document.querySelector('[class*="loading"]') ||
             !!document.querySelector('[class*="stop"]')
    }).catch(() => false)
    if (isThinking && i % 10 === 0) log('debug', 'Model is thinking...')
    await page.waitForTimeout(500)
  }

  if (!newElementAppeared) {
    // Capture diagnostics before reporting failure
    const selectorCounts: Record<string, number> = {}
    for (const sel of RESPONSE_SELECTOR_FALLBACKS) {
      selectorCounts[sel] = await page.locator(sel).count().catch(() => -1)
    }

    const diagnostics = await page.evaluate(() => {
      const url = window.location.href
      const isLogin = url.includes('sign_in') || url.includes('login')
      const errorText = (() => {
        const candidates = document.querySelectorAll('[class*="error"], [class*="retry"], [class*="warning"], [class*="toast"], [class*="limit"]')
        for (const el of Array.from(candidates)) {
          const text = el.textContent || ''
          const lower = text.toLowerCase()
          if (lower.includes('network') || lower.includes('retry') || lower.includes('limit')) {
            return text.slice(0, 200)
          }
        }
        return null
      })()
      const bodyClasses = document.body?.className || ''
      return { url, isLogin, errorText, bodyClasses }
    }).catch(() => ({ url: 'unknown', isLogin: false, errorText: null, bodyClasses: '' }))

    // Save failure screenshot for debugging
    const isDev = process.env.NODE_ENV === 'development'
    const debugDir = join(homedir(), '.deepsproxy')
    if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true })
    const screenshotPath = join(debugDir, `failure-${Date.now()}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

    log('error', 'Response detection failed', { ...diagnostics, selectorCounts, screenshotPath })

    if (diagnostics.isLogin) {
      yield { token: '', done: true, error: 'Session expired. Run "deepseek logout" then log in again.' }
    } else if (diagnostics.errorText) {
      const lower = diagnostics.errorText.toLowerCase()
      if (lower.includes('network') || lower.includes('retry')) {
        yield { token: '', done: true, error: 'Oscilação de rede no DeepSeek. Tente novamente.' }
      } else if (lower.includes('limit') || lower.includes('rate')) {
        yield { token: '', done: true, error: 'Rate limit do DeepSeek atingido. Aguarde um momento e tente novamente.' }
      } else {
        const msg = isDev ? `DeepSeek error: ${diagnostics.errorText}` : 'Erro inesperado do DeepSeek. Tente novamente.'
        yield { token: '', done: true, error: msg }
      }
    } else {
      const msg = isDev
        ? `Sem resposta do DeepSeek (timeout). Screenshot: ${screenshotPath}`
        : 'Sem resposta do DeepSeek (timeout). Tente novamente.'
      yield { token: '', done: true, error: msg }
    }
    return
  }

  const callbackName = `__dsProxy_${Date.now()}`
  const queue: string[] = []
  let done = false
  let resolveWait: (() => void) | null = null

  await page.exposeFunction(callbackName, (data: string) => {
    if (data === '__DONE__') {
      done = true
    } else {
      queue.push(data)
    }
    if (resolveWait) { resolveWait(); resolveWait = null }
  })

  const BT = '`'
  const injectedScript = [
    '(function() {',
    '  var sel = ' + JSON.stringify(activeSelector) + ';',
    '  var cb = ' + JSON.stringify(callbackName) + ';',
    '  var baseCount = ' + initialCount + ';',
    '  var target = document.querySelectorAll(sel)[baseCount];',
    '  if (!target) return;',
    '  var lastLen = 0;',
    '  var htmlToText = function(el) {',
    '    var clone = el.cloneNode(true);',
    '    clone.querySelectorAll("button, svg, [class*=action], [class*=copy], [class*=download], [class*=toolbar], [class*=footer]").forEach(function(n) { n.remove(); });',
    '    var html = clone.innerHTML;',
    '    return html',
    '      .replace(/<br\\s*\\/?>/gi, "\\n")',
    '      .replace(/<\\/p>/gi, "\\n\\n")',
    '      .replace(/<\\/h[1-6]>/gi, "\\n\\n")',
    '      .replace(/<\\/li>/gi, "\\n")',
    '      .replace(/<li[^>]*>/gi, "- ")',
    '      .replace(/<h1[^>]*>/gi, "# ")',
    '      .replace(/<h2[^>]*>/gi, "## ")',
    '      .replace(/<h3[^>]*>/gi, "### ")',
    '      .replace(/<strong[^>]*>/gi, "**")',
    '      .replace(/<\\/strong>/gi, "**")',
    '      .replace(/<em[^>]*>/gi, "*")',
    '      .replace(/<\\/em>/gi, "*")',
    '      .replace(/<pre[^>]*><code[^>]*>/gi, ' + JSON.stringify(BT + BT + BT + '\n') + ')',
    '      .replace(/<\\/code><\\/pre>/gi, ' + JSON.stringify('\n' + BT + BT + BT) + ')',
    '      .replace(/<code[^>]*>/gi, ' + JSON.stringify(BT) + ')',
    '      .replace(/<\\/code>/gi, ' + JSON.stringify(BT) + ')',
    '      .replace(/<[^>]+>/g, "")',
    '      .replace(/&lt;/g, "<")',
    '      .replace(/&gt;/g, ">")',
    '      .replace(/&amp;/g, "&")',
    '      .replace(/&quot;/g, \'"\')',
    '      .replace(/\\n{3,}/g, "\\n\\n")',
    '      .trim();',
    '  };',
    '  var flush = function() {',
    '    var text = htmlToText(target);',
    '    if (text.length > lastLen) {',
    '      var delta = text.slice(lastLen);',
    '      lastLen = text.length;',
    '      window[cb](delta);',
    '    }',
    '  };',
    // Expose flush so we can call it immediately after attaching
    '  window[cb + "_flush"] = flush;',
    '  var observer = new MutationObserver(function() { flush(); });',
    '  observer.observe(target, { childList: true, subtree: true, characterData: true });',
    '  var idleStreak = 0;',
    '  var lastMutationTime = Date.now();',
    '  var startTime = Date.now();',
    '  observer.disconnect();',
    '  var trackedObserver = new MutationObserver(function() { flush(); lastMutationTime = Date.now(); idleStreak = 0; });',
    '  trackedObserver.observe(target, { childList: true, subtree: true, characterData: true });',
    '  var checkDone = setInterval(function() {',
    '    var hasStop = !!document.querySelector("[class*=stop]") ||',
    '                  !!document.querySelector("[class*=loading]") ||',
    '                  !!document.querySelector("[class*=typing]");',
    '    if (hasStop) { idleStreak = 0; lastMutationTime = Date.now(); return; }',
    '    if (Date.now() - startTime < 4000) return;',
    // Only count idle if no mutations for at least 1500ms (5 * 300ms)
    '    if (Date.now() - lastMutationTime < 3000) return;',
    '    idleStreak++;',
    '    if (idleStreak >= 12) {',
    '      flush();',
    '      clearInterval(checkDone);',
    '      trackedObserver.disconnect();',
    '      window[cb]("__DONE__");',
    '    }',
    '  }, 300);',
    '  window.__dsProxyCleanup = function() {',
    '    clearInterval(checkDone);',
    '    trackedObserver.disconnect();',
    '  };',
    '})();',
  ].join('\n')
  await page.addScriptTag({ content: injectedScript })

  // Do an immediate flush in case the response was already fully rendered
  // before the MutationObserver was attached
  await page.evaluate((cbName) => {
    if ((window as any)[cbName + '_flush']) {
      (window as any)[cbName + '_flush']()
    }
  }, callbackName).catch(() => {})

  while (Date.now() < deadline) {
    if (queue.length > 0) {
      const batch = queue.splice(0, queue.length).join('')
      yield { token: batch, done: false }
    }
    if (done) break
    await Promise.race([
      new Promise<void>((r) => { resolveWait = r }),
      page.waitForTimeout(100),
    ])
  }

  if (queue.length > 0) {
    yield { token: queue.splice(0, queue.length).join(''), done: false }
  }

  await page.evaluate(() => {
    if ((window as any).__dsProxyCleanup) {
      (window as any).__dsProxyCleanup()
      delete (window as any).__dsProxyCleanup
    }
  }).catch(() => {})

  yield { token: '', done: true }
}
