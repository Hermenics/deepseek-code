import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchBrowser, type LaunchedBrowser } from './launcher.js'
import { cachedClassifier, isLoopbackHost, type Classification } from './policy.js'
import { wrapUntrusted } from './snapshot.js'
import { Tab } from './tab.js'

/** Browser state for one agent: `${sessionId}|main`, or `${sessionId}|${taskId}` for a subagent. */
interface ContextState {
  key: string
  browserContextId: string
  tabs: Tab[]
  active: number
  /** Origins the user approved for navigation in this context. */
  approved: Set<string>
  /** Notes for the next action result (new tab opened, tab crashed…). */
  notes: string[]
  /** Private folder downloads land in (named by download id); deleted with the context. */
  downloads: string
}

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024

export interface BrowserStatus {
  running: boolean
  visible: boolean
  pid?: number
  contexts: Array<{ key: string; active: number; approved: string[]; tabs: Array<{ url: string; title: string }> }>
}

const IDLE_CLOSE_MS = 5 * 60_000
const TAB_ATTACH_TIMEOUT_MS = 10_000
const LOOPBACK_WEBSOCKETS = ['ws://localhost*', 'wss://localhost*', 'ws://127.*', 'wss://127.*', 'ws://[::1]*', 'wss://[::1]*']

/** Context key for a tool call: the main agent or one subagent task of a session. */
export function contextKey(sessionId: string, taskId?: string): string {
  return `${sessionId}|${taskId ?? 'main'}`
}

function isLoopbackUrl(url: string): boolean {
  try { return isLoopbackHost(new URL(url).hostname) } catch { return url === 'about:blank' }
}

/**
 * The one browser of this process. It starts on first use, gives every agent its own isolated
 * browser context (cookies, storage), routes every new page and out-of-process iframe through
 * the origin policy, and shuts down after five idle minutes or with the session.
 */
export class BrowserService {
  private browser: LaunchedBrowser | null = null
  private launching: Promise<LaunchedBrowser> | null = null
  private contexts = new Map<string, ContextState>()
  private byBrowserContextId = new Map<string, ContextState>()
  private tabContext = new Map<Tab, ContextState>()
  private tabBySession = new Map<string, Tab>()
  /** Out-of-process iframe session → the tab that owns it. */
  private frameOwner = new Map<string, Tab>()
  private pendingTabs = new Map<string, (tab: Tab) => void>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private busy = 0
  private listeners = new Set<() => void>()
  private classify = cachedClassifier()
  private visible = false
  /** Set by /browser close: tool calls fail until the user's next prompt instead of silently relaunching. */
  private closedByUser = false

  constructor(private readonly launch: (visible: boolean) => LaunchedBrowser = visible => launchBrowser({ visible, executablePath: process.env.DEEPSEEK_CHROME_PATH || undefined })) {}

  /** Subscribes to status changes (for the status bar); returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private changed(): void {
    for (const listener of this.listeners) { try { listener() } catch { /* UI listener errors are not browser errors */ } }
  }

  status(): BrowserStatus {
    return {
      running: this.browser !== null,
      visible: this.visible,
      pid: this.browser?.pid,
      contexts: [...this.contexts.values()].map(context => ({
        key: context.key,
        active: context.active,
        approved: [...context.approved],
        tabs: context.tabs.map(tab => ({ url: tab.url, title: tab.title })),
      })),
    }
  }

  isVisible(): boolean {
    return this.visible
  }

  /** Called when the user sends a new prompt: a browser the user closed may start again on demand. */
  allowRelaunch(): void {
    this.closedByUser = false
  }

  approve(key: string, origin: string): void {
    this.contexts.get(key)?.approved.add(origin)
  }

  isApproved(key: string, origin: string): boolean {
    return this.contexts.get(key)?.approved.has(origin) ?? false
  }

  /** URL of the active tab of a context, if it exists. */
  currentUrl(key: string): string | undefined {
    const context = this.contexts.get(key)
    return context?.tabs[context.active]?.url
  }

  /** Notes queued for the next result of this context (new tab opened, crash…), cleared on read. */
  takeNotes(key: string): string[] {
    return this.contexts.get(key)?.notes.splice(0) ?? []
  }

  /**
   * Errors the active page logged since the agent last acted on it (an HMR reload that broke, a failing
   * poll), as page data for the start of the next turn; clears them so the next action does not repeat them.
   */
  takeIdleErrors(key: string): string | undefined {
    const context = this.contexts.get(key)
    const tab = context?.tabs[context.active]
    const errors = tab?.takeErrors() ?? []
    if (!tab || errors.length === 0) return undefined
    const lines = errors.slice(-5).map(entry => `[${entry.level}] ${entry.text.length > 200 ? `${entry.text.slice(0, 199)}…` : entry.text}`)
    return `${errors.length} new console/network error${errors.length === 1 ? '' : 's'} on the open page since your last browser call${errors.length > 5 ? ' (latest 5)' : ''}:\n${wrapUntrusted({ url: tab.url, title: tab.title }, lines.join('\n'))}`
  }

  /**
   * Runs `operation` on the context's active tab, launching the browser and the context on
   * demand. Operations on one tab are serialized; the idle timer restarts afterwards.
   */
  async withTab<T>(key: string, operation: (tab: Tab, context: { key: string; tabs: Tab[]; active: number }) => Promise<T>): Promise<T> {
    if (this.closedByUser) throw new Error('The user closed the browser. Ask before opening it again.')
    this.busy++
    this.cancelIdle()
    try {
      const context = await this.ensureContext(key)
      let tab = context.tabs[context.active]
      if (!tab) {
        tab = await this.openTab(context)
        context.active = context.tabs.indexOf(tab)
      }
      const active = tab
      return await active.run(() => operation(active, context))
    } finally {
      this.busy--
      this.scheduleIdle()
      this.changed()
    }
  }

  /** Opens a new tab in the context and makes it active. */
  async newTab(key: string): Promise<number> {
    const context = await this.ensureContext(key)
    const tab = await this.openTab(context)
    context.active = context.tabs.indexOf(tab)
    this.changed()
    return context.active
  }

  selectTab(key: string, index: number): void {
    const context = this.contexts.get(key)
    if (!context?.tabs[index]) throw new Error(`No tab ${index}; list tabs first`)
    context.active = index
    this.changed()
  }

  async closeTab(key: string, index: number): Promise<void> {
    const context = this.contexts.get(key)
    const tab = context?.tabs[index]
    if (!context || !tab) throw new Error(`No tab ${index}; list tabs first`)
    await this.browser?.connection.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {})
    this.dropTab(tab)
  }

  /** Applies the request policy for the tab's current origin: public pages get every request checked. */
  async applyTabPolicy(tab: Tab): Promise<void> {
    const loopback = isLoopbackUrl(tab.url)
    await tab.cdp.send('Fetch.enable', { patterns: loopback ? [{ resourceType: 'Document', requestStage: 'Request' }] : [{ urlPattern: '*', requestStage: 'Request' }] }, tab.sessionId).catch(() => {})
    await tab.cdp.send('Network.setBlockedURLs', { urls: loopback ? [] : LOOPBACK_WEBSOCKETS }, tab.sessionId).catch(() => {})
  }

  /** Classifies a URL with the shared DNS cache. */
  classifyUrl(url: string): Promise<Classification> {
    return this.classify(url)
  }

  /** Relaunches the browser visible or headless, reopening the main contexts' pages. Page state (forms, scroll) is lost. */
  async setVisible(visible: boolean): Promise<void> {
    if (visible === this.visible && this.browser) return
    if ([...this.contexts.keys()].some(key => !key.endsWith('|main'))) throw new Error('Subagents are using the browser; try again when they finish.')
    const saved = [...this.contexts.values()].map(context => ({ key: context.key, approved: [...context.approved], urls: context.tabs.map(tab => tab.url), active: context.active }))
    this.shutdown('visibility change')
    this.visible = visible
    for (const entry of saved) {
      const context = await this.ensureContext(entry.key)
      for (const origin of entry.approved) context.approved.add(origin)
      for (const url of entry.urls) {
        const tab = await this.openTab(context)
        if (url !== 'about:blank') await tab.navigate(url).catch(() => {})
        await this.applyTabPolicy(tab)
      }
      context.active = Math.min(entry.active, context.tabs.length - 1)
    }
    if (saved.length === 0) await this.ensureBrowser()
    this.changed()
  }

  /** Closes every context of a session (the agent session ended or moved to another project). */
  releaseSession(sessionId: string): void {
    for (const context of [...this.contexts.values()]) if (context.key.startsWith(`${sessionId}|`)) this.dropContext(context)
    if (this.contexts.size === 0) this.shutdown('session ended')
  }

  /** Disposes one subagent's context when its task ends. */
  releaseContext(key: string): void {
    const context = this.contexts.get(key)
    if (context) this.dropContext(context)
    if (this.contexts.size === 0) this.shutdown('no browser users left')
  }

  /** /browser close: frees everything now and refuses tool calls until the next prompt. */
  closeByUser(): void {
    this.shutdown('closed by the user')
    this.closedByUser = true
  }

  /** Kills the browser synchronously and forgets all state. */
  shutdown(reason = 'shutdown'): void {
    this.cancelIdle()
    const browser = this.browser
    this.browser = null
    this.launching = null
    for (const tab of this.tabContext.keys()) tab.dispose()
    for (const context of this.contexts.values()) rmSync(context.downloads, { recursive: true, force: true })
    this.downloads.clear()
    this.contexts.clear()
    this.byBrowserContextId.clear()
    this.tabContext.clear()
    this.tabBySession.clear()
    this.frameOwner.clear()
    this.pendingTabs.clear()
    if (browser) {
      browser.connection.close(reason)
      browser.kill()
    }
    this.changed()
  }

  private async ensureBrowser(): Promise<LaunchedBrowser> {
    if (this.browser && !this.browser.connection.closed) return this.browser
    this.launching ??= (async () => {
      const browser = this.launch(this.visible)
      const cdp = browser.connection
      cdp.on('Target.attachedToTarget', (params, parent) => { void this.onAttached(params as never, parent) })
      cdp.on('Target.detachedFromTarget', params => {
        const tab = this.tabBySession.get(String(params.sessionId))
        if (tab) this.dropTab(tab)
        this.frameOwner.delete(String(params.sessionId))
      })
      cdp.on('Inspector.targetCrashed', (_params, sessionId) => {
        const tab = sessionId ? this.tabBySession.get(sessionId) : undefined
        if (tab) {
          this.tabContext.get(tab)?.notes.push(`The page at ${tab.url} crashed; the tab was closed.`)
          this.dropTab(tab)
        }
      })
      cdp.on('Fetch.requestPaused', (params, sessionId) => {
        const owner = sessionId ? this.frameOwner.get(sessionId) : undefined
        if (owner) void this.answerFrameRequest(owner, sessionId!, params as never)
      })
      cdp.on('Browser.downloadWillBegin', params => this.onDownloadStart(params as never))
      cdp.on('Browser.downloadProgress', params => this.onDownloadProgress(params as never))
      void browser.exited.then(() => { if (this.browser === browser) this.shutdown('browser exited') })
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
      this.browser = browser
      return browser
    })().finally(() => { this.launching = null })
    return this.launching
  }

  private async ensureContext(key: string): Promise<ContextState> {
    const existing = this.contexts.get(key)
    if (existing) return existing
    const browser = await this.ensureBrowser()
    const { browserContextId } = await browser.connection.send<{ browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: true })
    // Downloads go to a private throwaway folder (mkdtemp is 0700), never the user's Downloads.
    const downloads = mkdtempSync(join(tmpdir(), 'deepseek-downloads-'))
    await browser.connection.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', browserContextId, downloadPath: downloads, eventsEnabled: true })
      .catch(() => browser.connection.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId }).catch(() => {}))
    const context: ContextState = { key, browserContextId, tabs: [], active: 0, approved: new Set(), notes: [], downloads }
    this.contexts.set(key, context)
    this.byBrowserContextId.set(browserContextId, context)
    return context
  }

  private async openTab(context: ContextState): Promise<Tab> {
    const browser = await this.ensureBrowser()
    const { targetId } = await browser.connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId })
    const existing = context.tabs.find(tab => tab.targetId === targetId)
    if (existing) return existing
    return new Promise<Tab>((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingTabs.delete(targetId); reject(new Error('The new tab did not attach')) }, TAB_ATTACH_TIMEOUT_MS)
      this.pendingTabs.set(targetId, tab => { clearTimeout(timer); resolve(tab) })
    })
  }

  /** Every new target arrives paused: pages become tabs under the policy, iframes get the policy, the rest just resume. */
  private async onAttached(params: { sessionId: string; waitingForDebugger: boolean; targetInfo: { targetId: string; type: string; url: string; browserContextId?: string; openerId?: string } }, parentSessionId?: string): Promise<void> {
    const cdp = this.browser?.connection ?? (await this.launching?.catch(() => null))?.connection
    if (!cdp) return
    const { sessionId, targetInfo } = params
    let resumed = false
    const resume = async () => {
      if (resumed) return
      resumed = true
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    }
    try {
      if (targetInfo.type === 'page') {
        const context = targetInfo.browserContextId ? this.byBrowserContextId.get(targetInfo.browserContextId) : undefined
        if (!context) return // the launch-time about:blank page in the default context; never used
        const tab = new Tab(cdp, sessionId, targetInfo.targetId, (owner, request) => this.allowRequest(owner, request))
        await tab.setup()
        this.tabContext.set(tab, context)
        await resume()
        await tab.enableDomains()
        context.tabs.push(tab)
        this.tabContext.set(tab, context)
        this.tabBySession.set(sessionId, tab)
        const pending = this.pendingTabs.get(targetInfo.targetId)
        if (pending) {
          this.pendingTabs.delete(targetInfo.targetId)
          pending(tab)
        } else {
          // Opened by the page (target=_blank, window.open): follow it, like a user would.
          context.active = context.tabs.length - 1
          context.notes.push(`The page opened a new tab (${context.active}); it is now the active tab.`)
        }
        this.changed()
      } else if (targetInfo.type === 'iframe') {
        const owner = parentSessionId ? this.tabBySession.get(parentSessionId) ?? this.frameOwner.get(parentSessionId) : undefined
        if (owner) {
          this.frameOwner.set(sessionId, owner)
          await cdp.send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] }, sessionId).catch(() => {})
          await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {})
        }
      }
    } finally {
      await resume()
    }
  }

  /**
   * The request policy. The main frame may only load origins the user approved for this context
   * (clicks and redirects elsewhere are refused and reported). Subframes and subresources may not
   * reach blocked addresses, and a public page may not reach this machine.
   */
  private async allowRequest(tab: Tab, request: { url: string; resourceType: string; frameId?: string }): Promise<boolean> {
    const context = this.tabContext.get(tab)
    if (!context) return false
    if (request.url === 'about:blank') return true
    const classification = await this.classify(request.url)
    const mainDocument = request.resourceType === 'Document' && (!request.frameId || request.frameId === tab.targetId)
    if (mainDocument) {
      const allowed = classification.kind !== 'blocked' && classification.origin !== undefined && context.approved.has(classification.origin)
      if (!allowed) tab.blockedNavigation = request.url
      return allowed
    }
    if (classification.kind === 'blocked') return false
    if (classification.kind === 'loopback') return isLoopbackUrl(tab.url)
    return true
  }

  private async answerFrameRequest(owner: Tab, sessionId: string, params: { requestId: string; request: { url: string }; resourceType: string }): Promise<void> {
    let allow = false
    try { allow = await this.allowRequest(owner, { url: params.request.url, resourceType: params.resourceType, frameId: 'subframe' }) } catch { allow = false }
    const cdp = owner.cdp
    await cdp.send(allow ? 'Fetch.continueRequest' : 'Fetch.failRequest', allow ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {})
  }

  private dropTab(tab: Tab): void {
    const context = this.tabContext.get(tab)
    tab.dispose()
    this.tabContext.delete(tab)
    this.tabBySession.delete(tab.sessionId)
    if (context) {
      const index = context.tabs.indexOf(tab)
      if (index >= 0) context.tabs.splice(index, 1)
      if (context.active >= context.tabs.length) context.active = Math.max(0, context.tabs.length - 1)
    }
    this.changed()
  }

  private readonly downloads = new Map<string, { context: ContextState; name: string; url: string }>()

  /** The download event names the frame; a page's main frame id is its target id. */
  private onDownloadStart(params: { guid: string; frameId: string; url: string; suggestedFilename: string }): void {
    const tab = [...this.tabContext.keys()].find(candidate => candidate.targetId === params.frameId)
    // ponytail: a download started inside an iframe has no tab match; it is credited to the only context when there is one.
    const context = tab ? this.tabContext.get(tab) : this.contexts.size === 1 ? [...this.contexts.values()][0] : undefined
    if (context) this.downloads.set(params.guid, { context, name: params.suggestedFilename, url: params.url })
  }

  private onDownloadProgress(params: { guid: string; receivedBytes: number; state: string }): void {
    const download = this.downloads.get(params.guid)
    if (!download) return
    const { context, name, url } = download
    if (params.state === 'inProgress' && params.receivedBytes > MAX_DOWNLOAD_BYTES) {
      void this.browser?.connection.send('Browser.cancelDownload', { guid: params.guid, browserContextId: context.browserContextId }).catch(() => {})
      return
    }
    if (params.state === 'inProgress') return
    this.downloads.delete(params.guid)
    context.notes.push(params.state === 'completed'
      ? `Downloaded "${name}" (${Math.max(1, Math.round(params.receivedBytes / 1024))} KB) from ${url} to ${join(context.downloads, params.guid)}; it is outside the project, so reading it asks the user.`
      : `The download of "${name}" was canceled${params.receivedBytes > MAX_DOWNLOAD_BYTES ? ' (over 50 MB)' : ''}.`)
  }

  private dropContext(context: ContextState): void {
    for (const tab of [...context.tabs]) this.dropTab(tab)
    this.contexts.delete(context.key)
    this.byBrowserContextId.delete(context.browserContextId)
    rmSync(context.downloads, { recursive: true, force: true })
    void this.browser?.connection.send('Target.disposeBrowserContext', { browserContextId: context.browserContextId }).catch(() => {})
    this.changed()
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private scheduleIdle(): void {
    this.cancelIdle()
    if (!this.browser) return
    this.idleTimer = setTimeout(() => { if (this.busy === 0) this.shutdown('idle for 5 minutes') }, IDLE_CLOSE_MS)
    this.idleTimer.unref?.()
  }
}

/** The process-wide browser. */
export const browserService = new BrowserService()
