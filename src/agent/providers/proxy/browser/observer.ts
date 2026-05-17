import type { Page } from 'playwright'
import type { TokenEvent } from '../types/index.js'
import { log } from '../config.js'

const RESPONSE_SELECTOR = '.ds-markdown'
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

  const initialCount = knownCount ?? await page.locator(RESPONSE_SELECTOR).count()
  log('debug', `Waiting for response (baseline: ${initialCount} elements)`)

  let newElementAppeared = false
  for (let i = 0; i < 120 && Date.now() < deadline; i++) {
    const currentCount = await page.locator(RESPONSE_SELECTOR).count()
    if (currentCount > initialCount) {
      newElementAppeared = true
      log('debug', `New response element appeared (${currentCount} total)`)
      break
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
    yield { token: '', done: true, error: 'No new response appeared from DeepSeek' }
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
    '  var sel = ' + JSON.stringify(RESPONSE_SELECTOR) + ';',
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
    '  var observer = new MutationObserver(function() { flush(); });',
    '  observer.observe(target, { childList: true, subtree: true, characterData: true });',
    '  var idleStreak = 0;',
    '  var startTime = Date.now();',
    '  var checkDone = setInterval(function() {',
    '    var hasStop = !!document.querySelector("[class*=stop]") ||',
    '                  !!document.querySelector("[class*=loading]") ||',
    '                  !!document.querySelector("[class*=typing]");',
    '    if (hasStop) { idleStreak = 0; return; }',
    '    if (Date.now() - startTime < 2000) return;',
    '    idleStreak++;',
    '    if (idleStreak >= 3) {',
    '      flush();',
    '      clearInterval(checkDone);',
    '      observer.disconnect();',
    '      window[cb]("__DONE__");',
    '    }',
    '  }, 300);',
    '  window.__dsProxyCleanup = function() {',
    '    clearInterval(checkDone);',
    '    observer.disconnect();',
    '  };',
    '})();',
  ].join('\n')
  await page.addScriptTag({ content: injectedScript })

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
