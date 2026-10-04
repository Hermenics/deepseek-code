import { stat } from 'node:fs/promises'
import type { PromptImage } from '../types/input.js'
import type { BrowserService } from './service.js'
import { diffSnapshots, findLines, isSensitiveField, renderSnapshot, wrapUntrusted, type Snapshot } from './snapshot.js'
import { abortable, KEYS, type Tab } from './tab.js'

export interface ActionEnv {
  key: string
  service: BrowserService
  tab: Tab
  signal?: AbortSignal
  attachImage?: (image: PromptImage, label: string) => void
  /** Inside a batch: navigation only to approved origins, and page output only once at the end. */
  inBatch?: boolean
  /** Resolves a workspace path the way file tools do (containment, symlinks, .deepseekignore); throws otherwise. */
  resolvePath?: (path: string) => Promise<string>
}

export interface ActionResult {
  ok: boolean
  /** One line for the result header (or the batch step list). */
  summary: string
  /** Page-derived detail (snapshot, diff, logs), already wrapped as untrusted. */
  detail?: string
}

type Args = Record<string, unknown>

/** Actions that change the page; they answer with what changed instead of a full snapshot. */
export const MUTATING = new Set(['click', 'hover', 'type', 'select', 'check', 'press', 'scroll', 'dialog', 'back', 'forward', 'reload', 'emulate', 'upload'])
export const KEY_NAMES = Object.keys(KEYS)
const MAX_DETAIL = 20_000

const fail = (summary: string): ActionResult => ({ ok: false, summary })
const str = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined

function page(tab: Tab, body: string): string {
  const text = body.length > MAX_DETAIL ? `${body.slice(0, MAX_DETAIL)}\n… output truncated` : body
  return wrapUntrusted({ url: tab.url, title: tab.title }, text)
}

/** Snapshot of the whole page (text included), kept as the diff baseline and for field labels. */
async function freshSnapshot(tab: Tab): Promise<Snapshot> {
  const snapshot = await tab.snapshot('full')
  tab.lastSnapshot = snapshot
  tab.baseline = snapshot
  return snapshot
}

/** Full-mode snapshot (including text) to diff the next action against. */
export async function baselineOf(tab: Tab): Promise<Snapshot> {
  tab.baseline ??= await tab.snapshot('full')
  return tab.baseline
}

/** What an action did to the page: a diff (text included) on the same document, the new page after a navigation. */
export async function describeChange(env: ActionEnv, before: Snapshot, refsBefore: unknown): Promise<string> {
  const { tab } = env
  // An open alert/confirm/prompt blocks the renderer: the page cannot be read until it is answered.
  if (tab.dialog) return 'The page is paused by the dialog; answer it with dialog to continue.'
  await recoverFromBlockedNavigation(env)
  await tab.refreshInfo()
  if (tab.refs !== refsBefore) {
    return `Now at ${tab.url}${tab.title ? ` — "${tab.title}"` : ''}\n${page(tab, renderSnapshot(await freshSnapshot(tab)))}`
  }
  const after = await tab.snapshot('full')
  tab.baseline = after
  const diff = diffSnapshots(before, after)
  return diff.length ? page(tab, diff.join('\n')) : 'No visible change on the page.'
}

/** A click or redirect toward an unapproved origin was refused by the policy: step back to the approved page. */
async function recoverFromBlockedNavigation(env: ActionEnv): Promise<void> {
  const { tab } = env
  if (!tab.blockedNavigation) return
  const history = await tab.cdp.send<{ currentIndex: number; entries: Array<{ id: number; url: string }> }>('Page.getNavigationHistory', {}, tab.sessionId).catch(() => null)
  const current = history?.entries[history.currentIndex]
  if (history && current && current.url === tab.blockedNavigation && history.currentIndex > 0) {
    await tab.cdp.send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1]!.id }, tab.sessionId).catch(() => {})
    await tab.settle(env.signal).catch(() => {})
  }
}

/** Notes that belong in any result: refused navigations, open dialogs, new tabs, new errors. */
export function collectNotes(env: ActionEnv): string[] {
  const { tab } = env
  const notes = env.service.takeNotes(env.key)
  if (tab.blockedNavigation) {
    notes.push(`Navigation to ${tab.blockedNavigation} was blocked: that origin is not approved. Call navigate with that URL to ask the user.`)
    tab.blockedNavigation = null
  }
  // Dialog and console text come from the page: they stay inside the untrusted envelope.
  if (tab.dialog) notes.push(`A ${tab.dialog.type} dialog is open; answer it with dialog (accept true/false) before acting on the page. Its message:\n${page(tab, tab.dialog.message)}`)
  const errors = tab.takeErrors()
  if (errors.length) {
    // The latest few inline, so the model rarely needs a separate logs call to see what failed.
    const shown = errors.slice(-3).map(entry => `[${entry.level}] ${entry.text.length > 200 ? `${entry.text.slice(0, 199)}…` : entry.text}`)
    notes.push(`⚠ ${errors.length} new console/network error${errors.length === 1 ? '' : 's'}${errors.length > 3 ? ' (latest 3; logs shows all)' : ''}:\n${page(tab, shown.join('\n'))}`)
  }
  return notes
}

async function point(env: ActionEnv, args: Args): Promise<{ x: number; y: number; backendNodeId?: number }> {
  const ref = str(args.ref)
  if (ref) return env.tab.pointFor(ref)
  if (typeof args.x === 'number' && typeof args.y === 'number') return { x: args.x, y: args.y }
  throw new Error('Give a ref from the latest snapshot (or x and y from the latest screenshot)')
}

async function navigate(env: ActionEnv, args: Args): Promise<ActionResult> {
  const url = str(args.url)
  if (!url) return fail('navigate needs a url')
  const target = await env.service.classifyUrl(url)
  if (target.kind === 'blocked' || !target.origin) return fail(`Blocked: ${target.reason ?? 'not an allowed URL'}`)
  if (env.inBatch && target.origin !== 'about:blank' && !env.service.isApproved(env.key, target.origin)) {
    return fail(`${target.origin} is not approved yet; navigate to it outside a batch first so the user can approve it`)
  }
  if (target.origin !== 'about:blank') env.service.approve(env.key, target.origin)
  const { tab } = env
  const result = await tab.navigate(url, env.signal)
  // Apps often fetch their data right after load; let that land before reading the page.
  if (!result.error && !result.timedOut) await tab.settle(env.signal)
  await tab.refreshInfo()
  if (result.error) {
    if (tab.blockedNavigation) return fail(`${url} redirected to ${tab.blockedNavigation}, an origin that is not approved. Call navigate with that URL to ask the user.`)
    const hint = target.kind === 'loopback' && /CONNECTION_REFUSED/.test(result.error) ? ' — is the dev server running?' : ''
    return fail(`Could not load ${url}: ${result.error}${hint}`)
  }
  await env.service.applyTabPolicy(tab)
  const snapshot = await freshSnapshot(tab)
  if (env.inBatch) return { ok: true, summary: `navigate ${tab.url}` }
  const status = result.timedOut ? ' (still loading after 30s; loading was stopped)' : ''
  return { ok: true, summary: `Opened ${tab.url}${tab.title ? ` — "${tab.title}"` : ''}${status}`, detail: page(tab, renderSnapshot(snapshot)) }
}

async function history(env: ActionEnv, action: 'back' | 'forward' | 'reload'): Promise<ActionResult> {
  const { tab } = env
  if (action === 'reload') {
    await tab.cdp.send('Page.reload', {}, tab.sessionId)
  } else {
    const entries = await tab.cdp.send<{ currentIndex: number; entries: Array<{ id: number }> }>('Page.getNavigationHistory', {}, tab.sessionId)
    const target = entries.entries[entries.currentIndex + (action === 'back' ? -1 : 1)]
    if (!target) return fail(`There is no page to go ${action} to`)
    await tab.cdp.send('Page.navigateToHistoryEntry', { entryId: target.id }, tab.sessionId)
  }
  tab.loading = true
  await tab.settle(env.signal)
  return { ok: true, summary: action === 'reload' ? 'Reloaded the page' : `Went ${action}` }
}

/** Focuses the element and selects its content, so inserted text replaces the current value. */
const FOCUS_AND_SELECT = `function () {
  this.focus()
  if (typeof this.select === 'function') { this.select(); return true }
  if (this.isContentEditable) { const range = document.createRange(); range.selectNodeContents(this); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true }
  return false
}`

/** Picks a native <select> option by label or value and fires the events frameworks listen to. */
const SELECT_OPTION = `function (wanted) {
  if (this.tagName !== 'SELECT') return 'not a native select; click it and then click the option'
  const option = [...this.options].find(o => o.label === wanted || o.value === wanted || o.text.trim() === wanted)
  if (!option) return 'no option ' + JSON.stringify(wanted) + '; options: ' + [...this.options].map(o => o.label).join(', ')
  this.value = option.value
  this.dispatchEvent(new Event('input', { bubbles: true }))
  this.dispatchEvent(new Event('change', { bubbles: true }))
  return ''
}`

/** Sets the files of an `<input type=file>`; only files inside the workspace, like the file tools. */
async function upload(env: ActionEnv, args: Args): Promise<ActionResult> {
  const { tab } = env
  const ref = str(args.ref)
  const paths = Array.isArray(args.paths) ? args.paths.filter((path): path is string => typeof path === 'string') : []
  if (!ref) return fail('upload needs the ref of a file input')
  if (paths.length === 0 || paths.length > 10) return fail('upload needs 1-10 workspace file paths')
  if (!env.resolvePath) return fail('uploads are unavailable here')
  const files: string[] = []
  for (const path of paths) {
    const resolved = await env.resolvePath(path)
    if (!(await stat(resolved).catch(() => null))?.isFile()) return fail(`${path} is not a file`)
    files.push(resolved)
  }
  // File inputs are often hidden behind a styled label, so no hit test: address the node directly.
  const backendNodeId = tab.refs.node(ref)
  if (backendNodeId === undefined) return fail(`Unknown ref ${ref}; take a new snapshot`)
  const { nodeName, attributes } = await tab.describe(backendNodeId)
  const typeIndex = attributes.findIndex((value, index) => index % 2 === 0 && value === 'type')
  if (nodeName !== 'INPUT' || attributes[typeIndex + 1]?.toLowerCase() !== 'file') return fail(`${ref} is not a file input`)
  await tab.cdp.send('DOM.setFileInputFiles', { files, backendNodeId }, tab.sessionId)
  await tab.settle(env.signal)
  return { ok: true, summary: `Attached ${files.length} file${files.length === 1 ? '' : 's'} to ${ref}: ${paths.join(', ')}` }
}

async function typeText(env: ActionEnv, args: Args): Promise<ActionResult> {
  const { tab } = env
  const ref = str(args.ref)
  if (!ref) return fail('type needs the ref of a field from the latest snapshot')
  if (typeof args.text !== 'string') return fail('type needs text')
  const { backendNodeId } = await tab.pointFor(ref)
  const { attributes } = await tab.describe(backendNodeId)
  const label = tab.lastSnapshot?.lines.find(line => line.ref === ref)?.text ?? ''
  if (isSensitiveField(attributes, label)) {
    return fail(`${ref} looks like a password, payment or one-time-code field. Never type into it: use handoff so the user fills it in themselves.`)
  }
  await tab.callOn(backendNodeId, FOCUS_AND_SELECT)
  await tab.cdp.send('Input.insertText', { text: args.text }, tab.sessionId)
  if (args.submit === true) await tab.press('Enter')
  await tab.settle(env.signal)
  return { ok: true, summary: `Typed ${args.text.length} characters into ${ref}${args.submit === true ? ' and pressed Enter' : ''}` }
}

/** Polls the page until the condition holds (or no longer holds, with `gone`) or the timeout passes. */
async function waitFor(env: ActionEnv, args: Args, defaultTimeout: number): Promise<{ met: boolean; waited: number; what: string }> {
  const { tab } = env
  const timeout = Math.min(Math.max(Number(args.timeoutMs ?? defaultTimeout), 0), 30_000)
  const text = str(args.text)
  const ref = str(args.ref)
  const url = str(args.url)
  const gone = args.gone === true
  if ([text, ref, url].filter(Boolean).length !== 1) throw new Error('Give exactly one of text, ref or url to wait for')
  if (args.noErrors === true) throw new Error('Check noErrors separately from text, ref or url')
  const what = text ? `text ${JSON.stringify(text)}` : ref ? `element ${ref}` : url ? `URL containing ${JSON.stringify(url)}` : ''
  if (!what) throw new Error('Give text, ref or url to wait for')
  const started = Date.now()
  for (;;) {
    let present: boolean
    if (url) {
      await tab.refreshInfo()
      present = tab.url.includes(url)
    } else {
      const snapshot = await tab.snapshot('full')
      present = text ? findLines(snapshot, text).length > 0 : snapshot.lines.some(line => line.ref === ref)
    }
    if (present !== gone) return { met: true, waited: Date.now() - started, what }
    if (Date.now() - started >= timeout) return { met: false, waited: Date.now() - started, what }
    await abortable(Bun.sleep(250), env.signal)
  }
}

const MARKS_ID = '__deepseek_marks'
const MAX_MARKS = 150

/**
 * Outlines every interactive element in view and labels it with its ref, in a closed, aria-hidden,
 * click-through overlay that exists only for the capture. Returns how many were labeled.
 */
async function drawMarks(tab: Tab): Promise<number> {
  const snapshot = await tab.snapshot('interactive')
  tab.lastSnapshot = null // refs stay valid; the next diff re-reads the page
  const boxes: Array<[string, number, number, number, number]> = []
  for (const line of snapshot.lines) {
    if (!line.ref || boxes.length >= MAX_MARKS) continue
    const backendNodeId = tab.refs.node(line.ref)
    if (backendNodeId === undefined) continue
    const box = await tab.cdp.send<{ model: { border: number[] } }>('DOM.getBoxModel', { backendNodeId }, tab.sessionId).catch(() => null)
    if (!box) continue
    const xs = box.model.border.filter((_, i) => i % 2 === 0), ys = box.model.border.filter((_, i) => i % 2 === 1)
    const [x, y, w, h] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    if (w > 0 && h > 0 && x + w > 0 && y + h > 0 && x < 4000 && y < 4000) boxes.push([line.ref, x, y, w, h])
  }
  if (!boxes.length) return 0
  await tab.cdp.send('Runtime.evaluate', { expression: `(() => {
    const host = document.createElement('div'); host.id = '${MARKS_ID}'; host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const root = host.attachShadow({ mode: 'closed' })
    for (const [ref, x, y, w, h] of ${JSON.stringify(boxes)}) {
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed;box-sizing:border-box;border:2px solid #e11d48;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px'
      const label = document.createElement('span'); label.textContent = ref
      label.style.cssText = 'position:absolute;left:-2px;top:-16px;background:#e11d48;color:#fff;font:bold 11px/14px monospace;padding:0 3px;border-radius:2px'
      box.append(label); root.append(box)
    }
    document.documentElement.append(host)
  })()` }, tab.sessionId)
  return boxes.length
}

async function screenshot(env: ActionEnv, args: Args): Promise<ActionResult> {
  if (!env.attachImage) return fail('The current model does not accept images. Use snapshot instead (or turn on "Image input" for this provider profile if it supports images).')
  const { tab } = env
  let clip: { x: number; y: number; width: number; height: number } | undefined
  if (str(args.ref)) {
    const { backendNodeId } = await tab.pointFor(String(args.ref))
    const { model } = await tab.cdp.send<{ model: { border: number[] } }>('DOM.getBoxModel', { backendNodeId }, tab.sessionId)
    const xs = model.border.filter((_, i) => i % 2 === 0)
    const ys = model.border.filter((_, i) => i % 2 === 1)
    const { cssVisualViewport } = await tab.cdp.send<{ cssVisualViewport: { pageX: number; pageY: number } }>('Page.getLayoutMetrics', {}, tab.sessionId)
    clip = { x: Math.min(...xs) + cssVisualViewport.pageX, y: Math.min(...ys) + cssVisualViewport.pageY, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  if (args.marks === true && (clip || args.fullPage === true)) return fail('marks work on viewport screenshots only')
  const marked = args.marks === true ? await drawMarks(tab) : 0
  let data: string
  try {
    data = await tab.screenshot({ fullPage: args.fullPage === true, clip })
  } finally {
    if (args.marks === true) await tab.cdp.send('Runtime.evaluate', { expression: `document.getElementById('${MARKS_ID}')?.remove()` }, tab.sessionId).catch(() => {})
  }
  env.attachImage({ mediaType: 'image/jpeg', data }, `screenshot of ${tab.url}${marked ? ` with ${marked} ref labels` : ''}`)
  return { ok: true, summary: `Screenshot of ${str(args.ref) ?? (args.fullPage === true ? 'the full page' : 'the viewport')}${marked ? ` with ${marked} elements labeled by ref` : ''} attached for your next step (${Math.round(data.length * 0.75 / 1024)} KB JPEG)` }
}

async function network(env: ActionEnv, args: Args): Promise<ActionResult> {
  const { tab } = env
  const id = str(args.id)
  if (id) {
    const entry = tab.networkEntries().find(item => item.id === id)
    if (!entry) return fail(`No request ${id}; list requests first`)
    const body = await tab.cdp.send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId: id }, tab.sessionId).catch(() => null)
    let text = body ? body.base64Encoded ? `[binary body, ${Math.round(body.body.length * 0.75)} bytes]` : body.body : '[body not available]'
    try { if (body && !body.base64Encoded) text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* not JSON */ }
    let sent = entry.postData
    try { if (sent) sent = JSON.stringify(JSON.parse(sent), null, 2) } catch { /* not JSON */ }
    const detail = sent ? `Request body:\n${sent}\nResponse body:\n${text}` : text
    return { ok: true, summary: `${entry.method} ${entry.url} → ${entry.status ?? entry.failed ?? 'pending'}`, detail: page(tab, detail) }
  }
  const filter = str(args.filter)
  const entries = tab.networkEntries()
    .filter(entry => !filter || entry.url.includes(filter))
    .filter(entry => args.failedOnly !== true || entry.failed || (entry.status ?? 0) >= 400)
    .slice(-50)
  if (!entries.length) return { ok: true, summary: 'No matching requests.' }
  const lines = entries.map(entry => `${entry.id} ${entry.method} ${entry.status ?? entry.failed ?? 'pending'} ${entry.type ?? ''} ${entry.url.slice(0, 200)}`)
  return { ok: true, summary: `${entries.length} request${entries.length === 1 ? '' : 's'} (call network with id for a response body)`, detail: page(tab, lines.join('\n')) }
}

const DEVICES: Record<string, { width: number; height: number; scale: number; mobile: boolean }> = {
  mobile: { width: 390, height: 844, scale: 3, mobile: true },
  tablet: { width: 820, height: 1180, scale: 2, mobile: true },
}

/** Viewport and color scheme of the current tab: a phone/tablet preset, a custom size, or desktop to clear it. */
async function emulate(env: ActionEnv, args: Args): Promise<ActionResult> {
  const { tab } = env
  const device = str(args.device)
  const scheme = str(args.colorScheme)
  if (device && device !== 'desktop' && !DEVICES[device]) return fail('device must be mobile, tablet or desktop')
  if (scheme && !['light', 'dark'].includes(scheme)) return fail('colorScheme must be light or dark')
  const width = Number(args.width), height = Number(args.height)
  const custom = Number.isInteger(width) && Number.isInteger(height) && width >= 200 && height >= 200 && width <= 4000 && height <= 4000
  if (!device && !scheme && !custom) return fail('emulate needs device, width and height (200-4000), or colorScheme')
  const said: string[] = []
  if (device === 'desktop') {
    await tab.cdp.send('Emulation.clearDeviceMetricsOverride', {}, tab.sessionId)
    await tab.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, tab.sessionId)
    said.push('desktop viewport')
  } else if (device || custom) {
    const preset = device ? DEVICES[device]! : { width, height, scale: 1, mobile: false }
    await tab.cdp.send('Emulation.setDeviceMetricsOverride', { width: preset.width, height: preset.height, deviceScaleFactor: preset.scale, mobile: preset.mobile }, tab.sessionId)
    await tab.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: preset.mobile }, tab.sessionId)
    said.push(`${device ?? 'custom'} viewport ${preset.width}×${preset.height}${preset.mobile ? ' with touch' : ''}`)
  }
  if (scheme) {
    await tab.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, tab.sessionId)
    said.push(`${scheme} color scheme`)
  }
  await tab.settle(env.signal)
  await tab.cdp.send('Runtime.evaluate', {
    expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    awaitPromise: true,
  }, tab.sessionId)
  return { ok: true, summary: `Emulating ${said.join(' and ')} on this tab` }
}

async function tabs(env: ActionEnv, args: Args): Promise<ActionResult> {
  const op = str(args.op) ?? 'list'
  const index = typeof args.index === 'number' ? args.index : -1
  if (op === 'new') return { ok: true, summary: `Opened tab ${await env.service.newTab(env.key)} (blank); it is now active` }
  if (op === 'select') { env.service.selectTab(env.key, index); return { ok: true, summary: `Tab ${index} is now active` } }
  if (op === 'close') { await env.service.closeTab(env.key, index); return { ok: true, summary: `Closed tab ${index}` } }
  const context = env.service.status().contexts.find(item => item.key === env.key)
  const lines = (context?.tabs ?? []).map((tab, i) => `${i === context!.active ? '*' : ' '} ${i} ${tab.url}${tab.title ? ` — "${tab.title}"` : ''}`)
  return { ok: true, summary: `${lines.length} tab${lines.length === 1 ? '' : 's'}`, detail: page(env.tab, lines.join('\n')) }
}

/** Runs one action on the active tab. Mutating actions return a summary; the caller adds the page change. */
export async function performAction(env: ActionEnv, action: string, args: Args): Promise<ActionResult> {
  const { tab } = env
  if (tab.dialog && !['dialog', 'logs', 'network', 'tabs'].includes(action)) {
    return fail(`A ${tab.dialog.type} dialog is open; answer it with dialog first`)
  }
  switch (action) {
    case 'navigate': return navigate(env, args)
    case 'back': case 'forward': case 'reload': return history(env, action)
    case 'snapshot': {
      const scope = str(args.scope)
      const mode = args.mode === 'interactive' ? 'interactive' : 'full'
      const snapshot = await tab.snapshot(mode, scope)
      if (!scope && mode === 'full') { tab.lastSnapshot = snapshot; tab.baseline = snapshot }
      await tab.refreshInfo()
      return { ok: true, summary: `Snapshot of ${tab.url}${tab.title ? ` — "${tab.title}"` : ''}`, detail: page(tab, renderSnapshot(snapshot) || '(no content)') }
    }
    case 'find': {
      const query = str(args.query)
      if (!query) return fail('find needs a query')
      const matches = findLines(await tab.snapshot('full'), query, str(args.role))
      return matches.length
        ? { ok: true, summary: `${matches.length} match${matches.length === 1 ? '' : 'es'} for ${JSON.stringify(query)}`, detail: page(tab, matches.map(line => `- ${line.text}`).join('\n')) }
        : { ok: true, summary: `Nothing on the page matches ${JSON.stringify(query)}` }
    }
    case 'click': {
      const target = await point(env, args)
      await tab.click(target.x, target.y, args.double === true ? 2 : 1)
      await tab.settle(env.signal)
      return { ok: true, summary: `Clicked ${str(args.ref) ?? `(${Math.round(target.x)}, ${Math.round(target.y)})`}` }
    }
    case 'hover': {
      const target = await point(env, args)
      await tab.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y }, tab.sessionId)
      await tab.settle(env.signal)
      return { ok: true, summary: `Hovered ${str(args.ref) ?? 'the point'}` }
    }
    case 'type': return typeText(env, args)
    case 'select': {
      const ref = str(args.ref)
      if (!ref || typeof args.value !== 'string') return fail('select needs a ref and a value')
      const { backendNodeId } = await tab.pointFor(ref)
      const problem = await tab.callOn<string>(backendNodeId, SELECT_OPTION, [args.value])
      if (problem) return fail(`${ref}: ${problem}`)
      await tab.settle(env.signal)
      return { ok: true, summary: `Selected ${JSON.stringify(args.value)} in ${ref}` }
    }
    case 'check': {
      const ref = str(args.ref)
      if (!ref || typeof args.checked !== 'boolean') return fail('check needs a ref and checked: true/false')
      const target = await tab.pointFor(ref)
      const current = await tab.callOn<boolean>(target.backendNodeId, 'function () { return this.checked === true || this.getAttribute("aria-checked") === "true" }')
      if (current === args.checked) return { ok: true, summary: `${ref} was already ${args.checked ? 'checked' : 'unchecked'}` }
      await tab.click(target.x, target.y)
      await tab.settle(env.signal)
      return { ok: true, summary: `${args.checked ? 'Checked' : 'Unchecked'} ${ref}` }
    }
    case 'press': {
      const key = str(args.key)
      if (!key) return fail(`press needs a key: ${KEY_NAMES.join(', ')}`)
      await tab.press(key)
      await tab.settle(env.signal)
      return { ok: true, summary: `Pressed ${key}` }
    }
    case 'scroll': {
      const ref = str(args.ref)
      if (ref) await tab.pointFor(ref)
      else await tab.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: args.direction === 'up' ? -600 : 600 }, tab.sessionId)
      await tab.settle(env.signal)
      return { ok: true, summary: ref ? `Scrolled ${ref} into view` : `Scrolled ${args.direction === 'up' ? 'up' : 'down'}` }
    }
    case 'wait': case 'expect': {
      if (action === 'expect' && args.noErrors === true && !str(args.text) && !str(args.ref) && !str(args.url)) {
        const errors = tab.peekErrors()
        return errors.length ? fail(`expected no errors, found ${errors.length}: ${errors.slice(0, 3).map(entry => entry.text).join(' | ')}`) : { ok: true, summary: 'PASS: no console or network errors' }
      }
      const result = await waitFor(env, args, action === 'wait' ? 10_000 : 2_000)
      const state = args.gone === true ? 'gone' : 'present'
      if (!result.met) return fail(`${action === 'expect' ? 'Expectation failed: ' : ''}${result.what} not ${state} after ${result.waited}ms`)
      return { ok: true, summary: `${action === 'expect' ? 'PASS: ' : ''}${result.what} ${state}${result.waited ? ` after ${result.waited}ms` : ''}` }
    }
    case 'screenshot': return screenshot(env, args)
    case 'logs': {
      const entries = tab.drainLogs(args.errorsOnly === true)
      return entries.length
        ? { ok: true, summary: `${entries.length} console/network entr${entries.length === 1 ? 'y' : 'ies'} since the last check`, detail: page(tab, entries.map(entry => `[${entry.level}] ${entry.text}`).join('\n')) }
        : { ok: true, summary: 'No new console or network messages.' }
    }
    case 'network': return network(env, args)
    case 'tabs': return tabs(env, args)
    case 'emulate': return emulate(env, args)
    case 'upload': return upload(env, args)
    case 'dialog': {
      if (!tab.dialog) return fail('No dialog is open')
      const accept = args.accept === true
      await tab.cdp.send('Page.handleJavaScriptDialog', { accept, ...(typeof args.text === 'string' ? { promptText: args.text } : {}) }, tab.sessionId)
      tab.dialog = null
      await tab.settle(env.signal)
      return { ok: true, summary: accept ? 'Accepted the dialog' : 'Dismissed the dialog' }
    }
    default: return fail(`Unknown action ${action}`)
  }
}
