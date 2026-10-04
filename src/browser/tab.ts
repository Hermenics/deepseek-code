import type { CdpConnection } from './cdp.js'
import { buildSnapshot, RefTable, type AXNode, type Snapshot } from './snapshot.js'

export interface ConsoleEntry { level: string; text: string }
export interface NetworkEntry { id: string; method: string; url: string; type?: string; status?: number; failed?: string; mime?: string; postData?: string }
export interface DialogInfo { type: string; message: string }
interface NativeFrame { id: string; parentId?: string }
interface NativeFrameTree { frame: NativeFrame; childFrames?: NativeFrameTree[] }
interface NativeExecutionContext { id: number; origin: string; auxData?: { isDefault?: boolean; frameId?: string } }

/** Decides whether a paused request may proceed; the browser service applies the origin policy. */
export type RequestGate = (tab: Tab, request: { url: string; resourceType: string; frameId?: string }) => Promise<boolean>

const MAX_CONSOLE = 200

function isFavicon(url: string): boolean {
  try { return new URL(url).pathname === '/favicon.ico' } catch { return false }
}
const MAX_NETWORK = 300
const NAVIGATION_TIMEOUT_MS = 30_000

/** Key definitions for Input.dispatchKeyEvent. */
export const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
}

/** Rejects when `signal` aborts, so a stuck browser call never outlives Esc. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('Cancelled'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * One page target: event buffers (console, network, dialogs), the current document's refs and
 * last snapshot, and a queue so actions on the tab never overlap.
 */
export class Tab {
  url = 'about:blank'
  title = ''
  refs = new RefTable()
  lastSnapshot: Snapshot | null = null
  /** Full-mode snapshot (text included) that the next action's diff is computed against. */
  baseline: Snapshot | null = null
  dialog: DialogInfo | null = null
  /** Main-frame navigation the policy refused since the last report. */
  blockedNavigation: string | null = null
  loading = false
  private console: ConsoleEntry[] = []
  private network = new Map<string, NetworkEntry>()
  private unreadErrors = 0
  private inflight = new Set<string>()
  /** When a request last started or ended; settle waits for quiet measured from here. */
  private lastNetworkActivity = 0
  private queue: Promise<unknown> = Promise.resolve()
  private unsubscribe: Array<() => void> = []
  private loadWaiters: Array<() => void> = []
  private dialogWaiters: Array<() => void> = []
  private frameContexts = new Map<string, { sessionId: string; contextId: number; origin: string | undefined }>()

  constructor(
    readonly cdp: CdpConnection,
    readonly sessionId: string,
    readonly targetId: string,
    private readonly gate: RequestGate,
  ) {}

  /**
   * Installs the listeners and request gate while the target is paused, so no request can escape
   * the policy. `enableDomains` runs after resume because Page.enable on a paused popup can hang.
   */
  async setup(): Promise<void> {
    const on = (method: string, handler: (params: any) => void) => {
      this.unsubscribe.push(this.cdp.on(method, (params, sessionId) => { if (sessionId === this.sessionId) handler(params) }))
    }
    on('Page.frameNavigated', ({ frame }) => {
      if (frame.parentId) return
      this.url = frame.url
      this.refs = new RefTable()
      this.lastSnapshot = null
      this.baseline = null
    })
    on('Page.navigatedWithinDocument', ({ frameId, url }) => { if (frameId === this.targetId) this.url = url })
    on('Page.frameStartedLoading', ({ frameId }) => { if (frameId === this.targetId) this.loading = true })
    on('Page.frameStoppedLoading', ({ frameId }) => { if (frameId === this.targetId) this.finishLoad() })
    on('Page.loadEventFired', () => this.finishLoad())
    on('Page.javascriptDialogOpening', ({ type, message }) => {
      // beforeunload would silently hang the next navigation; accept it and keep the others for the agent.
      if (type === 'beforeunload') void this.cdp.send('Page.handleJavaScriptDialog', { accept: true }, this.sessionId).catch(() => {})
      else {
        this.dialog = { type, message: String(message).slice(0, 500) }
        for (const resolve of this.dialogWaiters.splice(0)) resolve()
      }
    })
    on('Page.javascriptDialogClosed', () => { this.dialog = null })
    on('Runtime.consoleAPICalled', ({ type, args }) => {
      const text = (args ?? []).map((arg: any) => arg.value ?? arg.description ?? arg.type).join(' ')
      this.log(type === 'warning' ? 'warn' : type, text)
    })
    on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      this.log('error', `Uncaught ${exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'exception'}`)
    })
    on('Runtime.executionContextCreated', ({ context }) => this.recordFrameContext(context))
    on('Runtime.executionContextDestroyed', ({ executionContextId }) => this.forgetFrameContext(executionContextId))
    on('Runtime.executionContextsCleared', () => this.forgetFrameSession(this.sessionId))
    on('Network.requestWillBeSent', ({ requestId, request, type }) => {
      this.inflight.add(requestId)
      this.lastNetworkActivity = Date.now()
      this.network.set(requestId, { id: requestId, method: request.method, url: request.url, type, postData: typeof request.postData === 'string' ? request.postData.slice(0, 4000) : undefined })
      if (this.network.size > MAX_NETWORK) this.network.delete(this.network.keys().next().value!)
    })
    on('Network.responseReceived', ({ requestId, response }) => {
      const entry = this.network.get(requestId)
      if (entry) { entry.status = response.status; entry.mime = response.mimeType }
      // Chrome asks every page for /favicon.ico; a dev app without one is not an error worth a model call.
      if (response.status >= 400 && !isFavicon(response.url)) this.log('network', `${response.status} ${entry?.method ?? 'GET'} ${response.url}`)
    })
    on('Network.loadingFinished', ({ requestId }) => { this.inflight.delete(requestId); this.lastNetworkActivity = Date.now() })
    on('Network.loadingFailed', ({ requestId, errorText, canceled }) => {
      this.inflight.delete(requestId)
      this.lastNetworkActivity = Date.now()
      const entry = this.network.get(requestId)
      if (entry) entry.failed = errorText
      if (!canceled && entry) this.log('network', `${errorText} ${entry.method} ${entry.url}`)
    })
    on('Fetch.requestPaused', params => { void this.decide(params) })
    // Gate subresources too until the service applies the current origin's policy.
    // A popup can load scripts/images immediately after resume, before Page.enable finishes.
    await this.cdp.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, this.sessionId)
  }

  /** Enables the event domains once the target runs; then reads the URL it may already have loaded. */
  async enableDomains(): Promise<void> {
    // Out-of-process iframes attach through this session too, so the gate sees their documents.
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, this.sessionId)
    for (const domain of ['Page', 'Runtime', 'Network', 'DOM', 'Accessibility']) await this.cdp.send(`${domain}.enable`, {}, this.sessionId)
    await this.refreshInfo()
  }

  /** Answers a paused request exactly once, failing it when the gate refuses or throws. */
  private async decide(params: { requestId: string; request: { url: string }; resourceType: string; frameId?: string }): Promise<void> {
    let allow = false
    try {
      allow = await this.gate(this, { url: params.request.url, resourceType: params.resourceType, frameId: params.frameId })
    } catch { allow = false }
    const method = allow ? 'Fetch.continueRequest' : 'Fetch.failRequest'
    await this.cdp.send(method, allow ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }, this.sessionId).catch(() => {})
  }

  recordFrameContext(context: NativeExecutionContext, sessionId = this.sessionId): void {
    const frameId = context.auxData?.frameId
    if (!context.auxData?.isDefault || typeof frameId !== 'string' || typeof context.id !== 'number') return
    let origin: string | undefined
    try { const url = new URL(context.origin); if (['http:', 'https:'].includes(url.protocol)) origin = url.origin } catch { /* opaque native context */ }
    this.frameContexts.set(frameId, { sessionId, contextId: context.id, origin })
  }

  forgetFrameContext(contextId: number, sessionId = this.sessionId): void {
    for (const [frame, value] of this.frameContexts) if (value.sessionId === sessionId && value.contextId === contextId) this.frameContexts.delete(frame)
  }

  forgetFrameSession(sessionId: string): void {
    for (const [frame, value] of this.frameContexts) if (value.sessionId === sessionId) this.frameContexts.delete(frame)
  }

  /** Default execution contexts distinguish inherited srcdoc from opaque frames. */
  async requestOrigin(frameId: string | undefined, document: boolean, sessionId = this.sessionId): Promise<string | undefined> {
    if (!frameId) return undefined
    const find = (tree: NativeFrameTree, id: string): NativeFrame | undefined => {
      if (tree.frame.id === id) return tree.frame
      for (const child of tree.childFrames ?? []) { const frame = find(child, id); if (frame) return frame }
      return undefined
    }
    let sourceId = frameId
    if (document) {
      const { frameTree } = await this.cdp.send<{ frameTree: NativeFrameTree }>('Page.getFrameTree', {}, sessionId)
      const frame = find(frameTree, frameId)
      if (!frame?.parentId) return undefined
      // An iframe navigation belongs to its parent; subsequent resources belong
      // to the committed child. OOP parent metadata lives in the owning tab.
      const parentId = frame.parentId
      let parent = find(frameTree, parentId)
      if (!parent && sessionId !== this.sessionId) {
        const owner = await this.cdp.send<{ frameTree: NativeFrameTree }>('Page.getFrameTree', {}, this.sessionId)
        parent = find(owner.frameTree, parentId)
      }
      if (!parent) return undefined
      sourceId = parent.id
    }
    // The initial request gate precedes Runtime.enable. Let the resumed target's
    // native context event arrive; an unknown or detached frame stays denied.
    const deadline = Date.now() + 1000
    while (!this.frameContexts.has(sourceId) && !this.cdp.closed && Date.now() < deadline) await Bun.sleep(10)
    return this.frameContexts.get(sourceId)?.origin
  }

  /** Runs `operation` after every earlier operation on this tab has finished. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.catch(() => {})
    return result
  }

  private log(level: string, text: string): void {
    this.console.push({ level, text: text.slice(0, 1000) })
    if (this.console.length > MAX_CONSOLE) this.console.shift()
    if (level === 'error' || level === 'network') this.unreadErrors++
  }

  private finishLoad(): void {
    this.loading = false
    for (const resolve of this.loadWaiters.splice(0)) resolve()
  }

  /** Error-level console entries and failed requests since the last drain, without clearing them. */
  peekErrors(): ConsoleEntry[] {
    return this.console.filter(entry => entry.level === 'error' || entry.level === 'network')
  }

  /** Errors and failed requests seen since the last call (oldest first); resets the counter. */
  takeErrors(): ConsoleEntry[] {
    const count = this.unreadErrors
    this.unreadErrors = 0
    return count ? this.peekErrors().slice(-count) : []
  }

  /** Console entries (optionally only errors/warnings) since the last drain, then clears them. */
  drainLogs(errorsOnly = false): ConsoleEntry[] {
    const entries = this.console.splice(0)
    this.unreadErrors = 0
    return errorsOnly ? entries.filter(entry => entry.level === 'error' || entry.level === 'warn' || entry.level === 'network') : entries
  }

  networkEntries(): NetworkEntry[] {
    return [...this.network.values()]
  }

  /** Navigates the main frame and waits for load (30s cap, then stops loading and keeps what rendered). */
  async navigate(url: string, signal?: AbortSignal): Promise<{ error?: string; timedOut?: boolean }> {
    this.loading = true
    const loaded = new Promise<void>(resolve => this.loadWaiters.push(resolve))
    const result = await abortable(this.cdp.send<{ errorText?: string }>('Page.navigate', { url }, this.sessionId, NAVIGATION_TIMEOUT_MS), signal)
    if (result.errorText) {
      this.finishLoad()
      return { error: result.errorText }
    }
    return this.waitForLoad(loaded, signal)
  }

  private async waitForLoad(loaded: Promise<void>, signal?: AbortSignal, timeoutMs = NAVIGATION_TIMEOUT_MS): Promise<{ timedOut?: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs) })
    try {
      if (await abortable(Promise.race([loaded.then(() => 'loaded' as const), timeout]), signal) === 'timeout') {
        await this.cdp.send('Page.stopLoading', {}, this.sessionId).catch(() => {})
        this.finishLoad()
        return { timedOut: true }
      }
      return {}
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * After an input action: wait for a navigation it started (10s cap), then for no request in
   * flight and none started or finished in the last 100ms (3s cap). An action that touched the
   * network waits it out; one that did not returns after the first 50ms.
   */
  async settle(signal?: AbortSignal): Promise<void> {
    await abortable(Bun.sleep(50), signal)
    if (this.loading) {
      const loaded = new Promise<void>(resolve => this.loadWaiters.push(resolve))
      await this.waitForLoad(loaded, signal, 10_000)
    }
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastNetworkActivity >= 100) return
      await abortable(Bun.sleep(25), signal)
    }
  }

  /** Refreshes `url` and `title` from the navigation history (the page title is not in any event). */
  async refreshInfo(): Promise<void> {
    const history = await this.cdp.send<{ currentIndex: number; entries: Array<{ url: string; title: string }> }>('Page.getNavigationHistory', {}, this.sessionId).catch(() => null)
    const entry = history?.entries[history.currentIndex]
    if (entry) { this.url = entry.url; this.title = entry.title }
  }

  /** Accessibility snapshot of the current document (or a ref's subtree). */
  async snapshot(mode: 'interactive' | 'full' = 'interactive', scope?: string): Promise<Snapshot> {
    const root = scope ? this.refs.node(scope) : undefined
    if (scope && root === undefined) throw new Error(`Unknown ref ${scope}; take a new snapshot`)
    const { nodes } = await this.cdp.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree', {}, this.sessionId)
    return buildSnapshot(nodes, this.refs, { mode, rootBackendNodeId: root })
  }

  /** Viewport point at the center of a ref's element, scrolled into view and checked for being on top. */
  async pointFor(ref: string): Promise<{ x: number; y: number; backendNodeId: number }> {
    const backendNodeId = this.refs.node(ref)
    if (backendNodeId === undefined) throw new Error(`Unknown ref ${ref}; take a new snapshot (refs reset when the page navigates)`)
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, this.sessionId)
    } catch {
      throw new Error(`Element ${ref} is no longer on the page; take a new snapshot`)
    }
    const { quads } = await this.cdp.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId }, this.sessionId)
      .catch(() => ({ quads: [] as number[][] }))
    const quad = quads[0]
    if (!quad) throw new Error(`Element ${ref} is not visible`)
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4
    return { x, y, backendNodeId }
  }

  /**
   * Sends an input event. An event whose handler opens alert/confirm/prompt only answers after the
   * dialog closes, so the wait also ends when a dialog opens; the late answer is ignored.
   */
  async input(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.dialog) return
    const sent = this.cdp.send(method, params, this.sessionId)
    sent.catch(() => {})
    const dialogOpened = new Promise<void>(resolve => this.dialogWaiters.push(resolve))
    await Promise.race([sent, dialogOpened])
  }

  async click(x: number, y: number, clickCount = 1): Promise<void> {
    await this.input('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.input('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount })
    }
  }

  async press(key: string): Promise<void> {
    const definition = KEYS[key]
    if (!definition) throw new Error(`Unsupported key ${key}; use one of ${Object.keys(KEYS).join(', ')}`)
    const base = { key, code: definition.code, windowsVirtualKeyCode: definition.keyCode, nativeVirtualKeyCode: definition.keyCode }
    await this.input('Input.dispatchKeyEvent', { ...base, type: definition.text ? 'keyDown' : 'rawKeyDown', ...(definition.text ? { text: definition.text } : {}) })
    await this.input('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  }

  /** Calls `fn` with the element as `this` (main world). Only fixed, tool-authored functions run here, never agent code. */
  async callOn<T>(backendNodeId: number, fn: string, args: unknown[] = []): Promise<T> {
    const { object } = await this.cdp.send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId }, this.sessionId)
    const { result, exceptionDetails } = await this.cdp.send<{ result: { value?: T }; exceptionDetails?: { text: string } }>('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: fn, arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true,
    }, this.sessionId)
    if (exceptionDetails) throw new Error(exceptionDetails.text)
    return result.value as T
  }

  async describe(backendNodeId: number): Promise<{ nodeName: string; attributes: string[] }> {
    const { node } = await this.cdp.send<{ node: { nodeName: string; attributes?: string[] } }>('DOM.describeNode', { backendNodeId }, this.sessionId)
    return { nodeName: node.nodeName, attributes: node.attributes ?? [] }
  }

  async screenshot(options: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}): Promise<string> {
    const params: Record<string, unknown> = { format: 'jpeg', quality: 60, captureBeyondViewport: options.fullPage === true }
    if (options.clip) params.clip = { ...options.clip, scale: 1 }
    else if (options.fullPage) {
      const { cssContentSize } = await this.cdp.send<{ cssContentSize: { width: number; height: number } }>('Page.getLayoutMetrics', {}, this.sessionId)
      params.clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 8000), scale: 1 }
    }
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', params, this.sessionId)
    return data
  }

  /** A human may have entered credentials; do not expose their console or request bodies to the agent. */
  clearHumanActivity(): void {
    this.console = []; this.network.clear(); this.unreadErrors = 0
  }

  dispose(): void {
    this.frameContexts.clear()
    for (const off of this.unsubscribe.splice(0)) off()
    for (const resolve of this.loadWaiters.splice(0)) resolve()
    for (const resolve of this.dialogWaiters.splice(0)) resolve()
  }
}
