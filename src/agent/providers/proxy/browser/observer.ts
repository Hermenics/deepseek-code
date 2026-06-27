/**
 * Builds the MutationObserver injected script for monitoring DeepSeek chat responses.
 * Used by the browser proxy to detect when a response is complete.
 */
export function buildInjectedScript(activeSelector: string, initialCount: number, callbackName: string): string {
  const BT = '`'
  return [
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
    '    if (Date.now() - startTime < ' + GRACE_PERIOD_MS + ') return;',
    '    if (Date.now() - lastMutationTime < ' + MUTATION_SILENCE_MS + ') return;',
    '    idleStreak++;',
    '    if (idleStreak >= ' + IDLE_STREAK_THRESHOLD + ') {',
    '      flush();',
    '      clearInterval(checkDone);',
    '      trackedObserver.disconnect();',
    '      window[cb]("__DONE__");',
    '    }',
    '  }, ' + POLL_INTERVAL_MS + ');',
    '  window.__dsProxyCleanup = function() {',
    '    clearInterval(checkDone);',
    '    trackedObserver.disconnect();',
    '  };',
    '})();',
  ].join('\n')
}

// ── Observer threshold constants ────────────────────────────────────────────

/** Number of consecutive idle checks before considering the response complete */
export const IDLE_STREAK_THRESHOLD = 12

/** Grace period (ms) before idle checks begin */
export const GRACE_PERIOD_MS = 4000

/** Minimum silence (ms) since last mutation before counting as idle */
export const MUTATION_SILENCE_MS = 3000

/** Polling interval (ms) for the idle check loop */
export const POLL_INTERVAL_MS = 300

/** Maximum wait loop iterations in observeResponse */
export const MAX_WAIT_ITERATIONS = 240

/** Delay per wait iteration (ms) */
export const WAIT_ITERATION_DELAY_MS = 500

/** Total maximum wait time (ms): MAX_WAIT_ITERATIONS * WAIT_ITERATION_DELAY_MS */
export const MAX_WAIT_MS = MAX_WAIT_ITERATIONS * WAIT_ITERATION_DELAY_MS
