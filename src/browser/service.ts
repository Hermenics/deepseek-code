import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { launchBrowser, type LaunchedBrowser } from './launcher.js'
import { cachedClassifier, isLoopbackHost, type Classification } from './policy.js'
import { wrapUntrusted } from './snapshot.js'
import { Tab } from './tab.js'
import { BrowserEgress, createEgressCertificate, type EgressCertificate, type EgressLaunchOptions } from './egress.js'

/** Browser state for one agent: `${sessionId}|main`, or `${sessionId}|${taskId}` for a subagent. */
interface ContextState {
  egress: BrowserEgress
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

interface WorkerOwner { context: ContextState; origin: string; targetId: string }
type RequestOwner = Tab | WorkerOwner

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

export interface BrowserNetworkTrust { certificateAuthority?: string }

/** Context key for a tool call: the main agent or one subagent task of a session. */
export function contextKey(sessionId: string, taskId?: string): string {
  return `${sessionId}|${taskId ?? 'main'}`
}

function isLoopbackUrl(url: string): boolean {
  try { return isLoopbackHost(new URL(url).hostname) } catch { return url === 'about:blank' }
}

/** Keep navigation paths, omitting query/hash values that can carry transient credentials. */
function savedPageUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    return `${url.origin}${url.pathname}`
  } catch { return undefined }
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
  private contextCreation = new Map<string, Promise<ContextState>>()
  private initialTabs = new Map<ContextState, Promise<Tab>>()
  private byBrowserContextId = new Map<string, ContextState>()
  private tabContext = new Map<Tab, ContextState>()
  private tabBySession = new Map<string, Tab>()
  private attachedSessions = new Set<string>()
  /** Out-of-process iframe session → the tab that owns it. */
  private frameOwner = new Map<string, Tab>()
  private frameByTarget = new Map<string, { tab: Tab; sessionId: string }>()
  /** Workers retain their creator origin even after a tab navigates or closes. */
  private workerOwner = new Map<string, WorkerOwner>()
  private workerByTarget = new Map<string, WorkerOwner>()
  private requestOwner = new Map<string, RequestOwner>()
  private pendingTabs = new Map<string, { resolve(tab: Tab): void; reject(error: Error): void }>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private busy = 0
  private retained = new Map<string, Set<symbol>>()
  private listeners = new Set<() => void>()
  private classify = cachedClassifier()
  private visible = false
  /** Set by /browser close: tool calls fail until the user's next prompt instead of silently relaunching. */
  private closedByUser = false
  private persistent: { key: string; directory: string } | null = null
  private closing = Promise.resolve()
  private closeError: Error | null = null
  private generation = 0
  private egressCertificate: EgressCertificate | null = null
  private egressGates = new Set<BrowserEgress>()
  private readonly launch: (visible: boolean, network: EgressLaunchOptions) => LaunchedBrowser

  constructor(launch?: (visible: boolean, network: EgressLaunchOptions) => LaunchedBrowser, private readonly networkTrust: BrowserNetworkTrust = {}) {
    this.launch = launch ?? ((visible, network) => launchBrowser({ ...network, visible, executablePath: process.env.DEEPSEEK_CHROME_PATH || undefined, profileDirectory: this.persistent?.directory }))
  }

  /** One persistent main context per worker; subagent contexts stay disposable and isolated. */
  configurePersistent(key: string, directory: string): void {
    if (!key.endsWith('|main')) throw new Error('A persistent profile belongs to the main bot context')
    if (this.browser || this.launching || this.contexts.size) throw new Error('Close the current browser before changing its profile')
    this.persistent = { key, directory }
  }

  async whenClosed(): Promise<void> {
    await this.closing
    const closeError = this.closeError
    this.closeError = null
    if (closeError) throw closeError
  }

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

  /** Human sessions may be idle for minutes without surrendering their page or unsaved form. */
  retain(key: string): () => void {
    const holders = this.retained.get(key) ?? new Set<symbol>(), token = Symbol(key)
    holders.add(token); this.retained.set(key, holders); this.cancelIdle()
    return () => {
      if (!holders.delete(token)) return
      if (!holders.size && this.retained.get(key) === holders) this.retained.delete(key)
      this.scheduleIdle()
    }
  }

  /** Called when the user sends a new prompt: a browser the user closed may start again on demand. */
  allowRelaunch(): void {
    this.closedByUser = false
  }

  approve(key: string, origin: string): void {
    this.contexts.get(key)?.approved.add(origin)
    for (const [sessionId, owner] of this.workerOwner) if (owner.context.key === key && owner.origin === origin) {
      void this.applyWorkerSocketPolicy(sessionId, owner).catch(() => {})
    }
  }

  isApproved(key: string, origin: string): boolean {
    return this.contexts.get(key)?.approved.has(origin) ?? false
  }

  /** URL of the active tab of a context, if it exists. */
  currentUrl(key: string): string | undefined {
    const context = this.contexts.get(key)
    return context?.tabs[context.active]?.url
  }

  currentDialog(key: string): { type: string; message: string } | undefined {
    const context = this.contexts.get(key), dialog = context?.tabs[context.active]?.dialog
    return dialog ? { ...dialog } : undefined
  }

  /** Notes queued for the next result of this context (new tab opened, crash…), cleared on read. */
  takeNotes(key: string): string[] {
    return this.contexts.get(key)?.notes.splice(0) ?? []
  }

  /** Clear telemetry in every tab the human may have used, including login popups. */
  clearHumanActivity(key: string): void {
    const context = this.contexts.get(key)
    if (context) { for (const tab of context.tabs) tab.clearHumanActivity(); context.notes = [] }
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
        let pending = this.initialTabs.get(context)
        if (!pending) {
          const opening = this.openTab(context).then(tab => { context.active = context.tabs.indexOf(tab); return tab }).finally(() => { if (this.initialTabs.get(context) === opening) this.initialTabs.delete(context) })
          this.initialTabs.set(context, opening)
          pending = opening
        }
        tab = await pending
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

  /** Local pages need the same private-network checks as public pages. */
  async applyTabPolicy(tab: Tab, sessionId = tab.sessionId): Promise<void> {
    const loopback = isLoopbackUrl(tab.url)
    await tab.cdp.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
    await tab.cdp.send('Network.setBlockedURLs', { urls: loopback ? [] : LOOPBACK_WEBSOCKETS }, sessionId)
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
    await this.shutdown('visibility change')
    await this.whenClosed()
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
    for (const key of this.retained.keys()) if (key.startsWith(`${sessionId}|`)) this.retained.delete(key)
    if (this.persistent?.key.startsWith(`${sessionId}|`)) { void this.shutdown('session ended'); return }
    for (const context of [...this.contexts.values()]) if (context.key.startsWith(`${sessionId}|`)) this.dropContext(context)
    if (this.contexts.size === 0) this.shutdown('session ended')
  }

  /** Disposes one subagent's context when its task ends. */
  releaseContext(key: string): void {
    this.retained.delete(key)
    if (key === this.persistent?.key) { void this.shutdown('main context ended'); return }
    const context = this.contexts.get(key)
    if (context) this.dropContext(context)
    if (this.contexts.size === 0) this.shutdown('no browser users left')
  }

  /** /browser close: frees everything now and refuses tool calls until the next prompt. */
  closeByUser(): void {
    this.shutdown('closed by the user')
    this.closedByUser = true
  }

  /** Clears live state immediately; persistent profiles close gracefully before a relaunch. */
  shutdown(reason = 'shutdown', saveState = true): Promise<void> {
    this.cancelIdle()
    const browser = this.browser
    const gates = [...this.egressGates]
    this.egressGates.clear()
    for (const gate of gates) gate.stop()
    this.egressCertificate = null
    this.generation++
    const state = this.persistent ? this.contexts.get(this.persistent.key) : undefined
    const urls = state?.tabs.map(tab => savedPageUrl(tab.url)).filter((url): url is string => url !== undefined) ?? []
    // A crash or a failed restore must preserve the last valid cookie cache.
    const save = browser && state && saveState && !browser.connection.closed ? this.savePersistentState(browser, urls) : Promise.resolve()
    this.browser = null
    this.launching = null
    for (const tab of this.tabContext.keys()) tab.dispose()
    for (const context of this.contexts.values()) rmSync(context.downloads, { recursive: true, force: true })
    this.downloads.clear()
    this.contexts.clear()
    this.contextCreation.clear()
    this.initialTabs.clear()
    this.byBrowserContextId.clear()
    this.tabContext.clear()
    this.tabBySession.clear()
    this.attachedSessions.clear()
    this.frameOwner.clear()
    this.frameByTarget.clear()
    this.workerOwner.clear()
    this.workerByTarget.clear()
    this.requestOwner.clear()
    for (const pending of this.pendingTabs.values()) pending.reject(new Error('Browser closed before the new tab attached'))
    this.pendingTabs.clear()
    if (browser && (browser.close || this.persistent)) {
      this.closing = save.then(() => browser.close ? browser.close() : browser.kill()).catch(async error => {
        this.closeError = error instanceof Error ? error : new Error('Codimium state could not be saved')
        browser.kill()
      }).then(() => browser.exited).then(() => {}).finally(async () => { browser.connection.close(reason); for (const gate of gates) gate.stop(); await Promise.all(gates.map(gate => gate.whenStopped())) })
    } else {
      if (browser) { browser.connection.close(reason); browser.kill() }
      for (const gate of gates) gate.stop()
      this.closing = Promise.all([this.closing, ...(browser ? [browser.exited] : []), ...gates.map(gate => gate.whenStopped())]).then(() => {})
    }
    this.changed()
    return this.closing
  }

  /** Session cookies live only in the private browser profile, never in model memory or event logs. */
  private async savePersistentState(browser: LaunchedBrowser, urls: string[]): Promise<void> {
    const persistent = this.persistent!
    const temporary = join(persistent.directory, `.state-${randomUUID()}.json`)
    try {
      const result = await browser.connection.send<{ cookies: Array<Record<string, unknown>> }>('Storage.getCookies')
      const cookies = result.cookies.filter(cookie => cookie.session === true).map(cookie => Object.fromEntries(
        ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'priority', 'sourceScheme', 'sourcePort', 'partitionKey'].filter(key => cookie[key] !== undefined).map(key => [key, cookie[key]]),
      ))
      await writeFile(temporary, JSON.stringify({ cookies, urls }), { mode: 0o600, flag: 'wx' })
      await rename(temporary, join(persistent.directory, 'deepseek-session.json'))
    } catch {
      throw new Error('Codimium session state could not be saved; inspect its private profile locally')
    } finally { await rm(temporary, { force: true }).catch(() => {}) }
  }

  private async restorePersistentState(browser: LaunchedBrowser, context: ContextState): Promise<void> {
    let raw: string
    try { raw = await readFile(join(this.persistent!.directory, 'deepseek-session.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Codimium session state could not be read') }
    try {
      const state = JSON.parse(raw) as { cookies: unknown[]; urls: unknown[] }
      if (!Array.isArray(state.cookies) || !Array.isArray(state.urls) || state.cookies.length > 5000 || state.urls.length > 100) throw new Error()
      if (state.cookies.length) await browser.connection.send('Storage.setCookies', { cookies: state.cookies })
      // ponytail: URLs are hints after a cold start; fresh origin approval precedes navigation.
      const urls = state.urls.filter((url): url is string => typeof url === 'string' && savedPageUrl(url) === url)
      if (urls.length) context.notes.push(`Codimium retained your browser storage. Previously open pages (navigate again with current approval): ${urls.join(', ')}`)
    } catch { throw new Error('Codimium session state is invalid; inspect its private profile locally') }
  }

  private async ensureBrowser(): Promise<LaunchedBrowser> {
    await this.whenClosed()
    if (this.launching) return this.launching
    if (this.browser && !this.browser.connection.closed) return this.browser
    if (this.browser) await this.shutdown('browser connection closed', false)
    this.launching ??= (async () => {
      const generation = this.generation
      const certificate = await createEgressCertificate()
      const defaultGate = await BrowserEgress.start(certificate, (url, origin) => this.allowContextEgress(this.persistent ? this.contexts.get(this.persistent.key) : undefined, url, origin), undefined, this.networkTrust.certificateAuthority)
      if (generation !== this.generation) { defaultGate.stop(); throw new Error('Browser launch was cancelled') }
      this.egressCertificate = certificate
      this.egressGates.add(defaultGate)
      this.watchGate(defaultGate, generation)
      let browser: LaunchedBrowser
      try { browser = this.launch(this.visible, defaultGate.launchOptions()) }
      catch (error) { defaultGate.stop(); this.egressGates.delete(defaultGate); this.egressCertificate = null; throw error }
      const cdp = browser.connection
      this.browser = browser
      try {
        const { arguments: args } = await cdp.send<{ arguments: string[] }>('Browser.getBrowserCommandLine')
        const network = defaultGate.launchOptions()
        const exact = (name: string, value: string) => args.filter(arg => arg.startsWith(`--${name}=`)).length === 1 && args.includes(`--${name}=${value}`)
        if (!exact('proxy-server', network.proxyServer) || !exact('proxy-bypass-list', network.proxyBypassList) || !exact('ignore-certificate-errors-spki-list', network.certificateSPKI)
          || args.some(arg => /^--(no-proxy-server|proxy-auto-detect|proxy-pac-url|ignore-certificate-errors)(=|$)/.test(arg)) || !args.includes('--disable-quic') || !args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')) throw new Error('Browser launcher omitted required network protection')
      } catch (error) { await this.shutdown('browser network configuration failed', false); throw error }
      const attaching = new Set<Promise<void>>()
      cdp.on('Target.attachedToTarget', (params, parent) => {
        const pending = this.onAttached(params as never, parent, generation)
        attaching.add(pending)
        void pending.catch(() => {}).finally(() => attaching.delete(pending))
      })
      cdp.on('Target.detachedFromTarget', params => {
        this.attachedSessions.delete(String(params.sessionId))
        const tab = this.tabBySession.get(String(params.sessionId))
        if (tab) this.dropTab(tab)
        this.frameOwner.get(String(params.sessionId))?.forgetFrameSession(String(params.sessionId))
        this.frameOwner.delete(String(params.sessionId))
        for (const [target, owner] of this.frameByTarget) if (owner.sessionId === params.sessionId) this.frameByTarget.delete(target)
        const worker = this.workerOwner.get(String(params.sessionId))
        this.workerOwner.delete(String(params.sessionId))
        if (worker && ![...this.workerOwner.values()].some(other => other.targetId === worker.targetId)) this.workerByTarget.delete(worker.targetId)
      })
      cdp.on('Inspector.targetCrashed', (_params, sessionId) => {
        const tab = sessionId ? this.tabBySession.get(sessionId) : undefined
        if (tab) {
          this.tabContext.get(tab)?.notes.push(`The page at ${tab.url} crashed; the tab was closed.`)
          this.dropTab(tab)
        }
      })
      cdp.on('Fetch.requestPaused', (params, sessionId) => {
        if (!sessionId) { void this.answerBrowserRequest(params as never); return }
        const owner = sessionId ? this.frameOwner.get(sessionId) : undefined
        if (owner) void this.answerFrameRequest(owner, sessionId!, params as never)
      })
      cdp.on('Fetch.authRequired', (params, sessionId) => {
        const challenge = params.authChallenge as { source?: string; origin?: string; realm?: string; scheme?: string }
        const gate = [...this.egressGates].find(gate => challenge.source === 'Proxy' && challenge.origin === gate.url && challenge.realm === gate.realm && challenge.scheme?.toLowerCase() === 'basic')
        const authChallengeResponse = gate ? { response: 'ProvideCredentials', username: gate.username, password: gate.password } : { response: challenge.source === 'Proxy' ? 'CancelAuth' : 'Default' }
        void cdp.send('Fetch.continueWithAuth', { requestId: params.requestId, authChallengeResponse }, sessionId).catch(() => {})
      })
      cdp.on('Runtime.executionContextCreated', (params, sessionId) => {
        if (sessionId) this.frameOwner.get(sessionId)?.recordFrameContext(params.context as never, sessionId)
      })
      cdp.on('Runtime.executionContextDestroyed', (params, sessionId) => {
        if (sessionId) this.frameOwner.get(sessionId)?.forgetFrameContext(Number(params.executionContextId), sessionId)
      })
      cdp.on('Runtime.executionContextsCleared', (_params, sessionId) => {
        if (sessionId) this.frameOwner.get(sessionId)?.forgetFrameSession(sessionId)
      })
      cdp.on('Network.requestWillBeSent', (params, sessionId) => {
        if (!sessionId || typeof params.requestId !== 'string') return
        const owner = this.workerOwner.get(sessionId) ?? this.tabBySession.get(sessionId) ?? this.frameOwner.get(sessionId)
        if (owner) {
          const previous = this.requestOwner.get(params.requestId)
          if (!previous || previous instanceof Tab || !(owner instanceof Tab)) this.requestOwner.set(params.requestId, owner)
          if (this.requestOwner.size > 4096) this.requestOwner.delete(this.requestOwner.keys().next().value!)
        }
      })
      for (const event of ['Network.loadingFinished', 'Network.loadingFailed']) cdp.on(event, params => { this.requestOwner.delete(String(params.requestId)) })
      cdp.on('Browser.downloadWillBegin', params => this.onDownloadStart(params as never))
      cdp.on('Browser.downloadProgress', params => this.onDownloadProgress(params as never))
      void browser.exited.then(() => { if (this.browser === browser) this.shutdown('browser exited', false) })
      try {
        if (this.persistent) {
          const context = this.createContextState(this.persistent.key, '', defaultGate)
          await this.configureDownloads(browser, context)
          await this.restorePersistentState(browser, context)
          // Chrome can report a concrete id for its default context. Record
          // only ids proved to be default, before restored workers attach.
          const { browserContextIds } = await cdp.send<{ browserContextIds: string[] }>('Target.getBrowserContexts')
          const { targetInfos } = await cdp.send<{ targetInfos: Array<{ browserContextId?: string }> }>('Target.getTargets')
          for (const target of targetInfos) if (target.browserContextId && !browserContextIds.includes(target.browserContextId)) this.byBrowserContextId.set(target.browserContextId, context)
        }
        // Worker sessions do not implement Fetch. The browser target does, and
        // intercepts their traffic while Network events identify the owner.
        await cdp.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
        await Promise.all([...attaching])
        if (generation !== this.generation) throw new Error('Browser launch was cancelled')
      } catch (error) { if (this.browser === browser) void this.shutdown('launch failed', false); else browser.kill(); throw error }
      return browser
    })().finally(() => { this.launching = null })
    return this.launching
  }

  private async ensureContext(key: string): Promise<ContextState> {
    const existing = this.contexts.get(key)
    if (existing && this.browser && !this.browser.connection.closed) {
      await this.launching
      if (this.contexts.get(key) !== existing) throw new Error('Browser context creation was cancelled')
      return existing
    }
    const pending = this.contextCreation.get(key)
    if (pending) return pending
    const creating = this.openContext(key).finally(() => { if (this.contextCreation.get(key) === creating) this.contextCreation.delete(key) })
    this.contextCreation.set(key, creating)
    return creating
  }

  private async openContext(key: string): Promise<ContextState> {
    const browser = await this.ensureBrowser()
    const generation = this.generation
    const restored = this.contexts.get(key)
    if (restored) return restored
    let context: ContextState | undefined
    const gate = await BrowserEgress.start(this.egressCertificate!, (url, origin) => this.allowContextEgress(context, url, origin), undefined, this.networkTrust.certificateAuthority)
    if (generation !== this.generation || this.browser !== browser) { gate.stop(); await gate.whenStopped(); throw new Error('Browser context creation was cancelled') }
    this.egressGates.add(gate)
    this.watchGate(gate, this.generation)
    let browserContextId: string
    try {
      const result = await browser.connection.send<{ browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: true, proxyServer: gate.url, proxyBypassList: '<-loopback>' })
      browserContextId = result.browserContextId
    } catch (error) { gate.stop(); this.egressGates.delete(gate); throw error }
    if (generation !== this.generation || this.browser !== browser) { gate.stop(); this.egressGates.delete(gate); await gate.whenStopped(); throw new Error('Browser context creation was cancelled') }
    context = this.createContextState(key, browserContextId, gate)
    await this.configureDownloads(browser, context)
    return context
  }

  private createContextState(key: string, browserContextId: string, egress: BrowserEgress): ContextState {
    // Downloads go to a private throwaway folder (mkdtemp is 0700), never the user's Downloads.
    const downloads = mkdtempSync(join(tmpdir(), 'deepseek-downloads-'))
    const context: ContextState = { key, browserContextId, egress, tabs: [], active: 0, approved: new Set(), notes: [], downloads }
    this.contexts.set(key, context)
    this.byBrowserContextId.set(browserContextId, context)
    return context
  }

  private watchGate(gate: BrowserEgress, generation: number): void {
    void gate.whenStopped().then(() => {
      if (generation === this.generation && this.egressGates.has(gate)) void this.shutdown('browser network protection exited', false)
    })
  }

  private async configureDownloads(browser: LaunchedBrowser, context: ContextState): Promise<void> {
    const scope = context.browserContextId ? { browserContextId: context.browserContextId } : {}
    await browser.connection.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', ...scope, downloadPath: context.downloads, eventsEnabled: true })
      .catch(() => browser.connection.send('Browser.setDownloadBehavior', { behavior: 'deny', ...scope }).catch(() => {}))
  }

  private async openTab(context: ContextState): Promise<Tab> {
    const browser = await this.ensureBrowser()
    const scope = context.browserContextId ? { browserContextId: context.browserContextId } : {}
    const { targetId } = await browser.connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', ...scope })
    const existing = context.tabs.find(tab => tab.targetId === targetId)
    if (existing) return existing
    return new Promise<Tab>((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingTabs.delete(targetId); reject(new Error('The new tab did not attach')) }, TAB_ATTACH_TIMEOUT_MS)
      this.pendingTabs.set(targetId, {
        resolve(tab) { clearTimeout(timer); resolve(tab) },
        reject(error) { clearTimeout(timer); reject(error) },
      })
    })
  }

  /** Page, iframe and worker HTTP gates are installed before their target resumes. */
  private async onAttached(params: { sessionId: string; waitingForDebugger: boolean; targetInfo: { targetId: string; type: string; url: string; browserContextId?: string; openerId?: string } }, parentSessionId?: string, generation = this.generation): Promise<void> {
    const cdp = this.browser?.connection
    if (!cdp || generation !== this.generation) return
    const { sessionId, targetInfo } = params
    this.attachedSessions.add(sessionId)
    let resumed = false
    let failed = false
    const resume = async () => {
      if (resumed) return
      resumed = true
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    }
    try {
      if (targetInfo.type === 'page') {
        const context = this.byBrowserContextId.get(targetInfo.browserContextId ?? '')
        if (!context) return // the launch-time about:blank page in the default context; never used
        const tab = new Tab(cdp, sessionId, targetInfo.targetId, (owner, request) => this.allowRequest(owner, request))
        tab.url = targetInfo.url || 'about:blank'
        await tab.setup()
        if (generation !== this.generation || !this.attachedSessions.has(sessionId)) { tab.dispose(); return }
        this.tabContext.set(tab, context)
        this.tabBySession.set(sessionId, tab)
        await resume()
        await tab.enableDomains()
        await this.applyTabPolicy(tab)
        if (generation !== this.generation || !this.attachedSessions.has(sessionId)) { tab.dispose(); return }
        context.tabs.push(tab)
        this.tabContext.set(tab, context)
        this.tabBySession.set(sessionId, tab)
        const pending = this.pendingTabs.get(targetInfo.targetId)
        if (pending) {
          this.pendingTabs.delete(targetInfo.targetId)
          pending.resolve(tab)
        } else {
          // Opened by the page (target=_blank, window.open): follow it, like a user would.
          context.active = context.tabs.length - 1
          context.notes.push(`The page opened a new tab (${context.active}); it is now the active tab.`)
        }
        this.changed()
      } else if (targetInfo.type === 'iframe') {
        const owner = parentSessionId ? this.tabBySession.get(parentSessionId) ?? this.frameOwner.get(parentSessionId) : undefined
        if (!owner) throw new Error('Browser iframe has no owning tab')
        this.frameOwner.set(sessionId, owner)
        this.frameByTarget.set(targetInfo.targetId, { tab: owner, sessionId })
        await cdp.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId)
        await resume()
        await cdp.send('Network.enable', {}, sessionId)
        await cdp.send('Runtime.enable', {}, sessionId)
        await this.applyTabPolicy(owner, sessionId)
      } else if (['worker', 'shared_worker', 'service_worker'].includes(targetInfo.type)) {
        const parentTab = parentSessionId ? this.tabBySession.get(parentSessionId) ?? this.frameOwner.get(parentSessionId) : undefined
        const parentWorker = parentSessionId ? this.workerOwner.get(parentSessionId) : undefined
        const context = parentTab ? this.tabContext.get(parentTab) : parentWorker?.context ?? this.byBrowserContextId.get(targetInfo.browserContextId ?? '')
        if (!context) throw new Error('Browser worker has no owned context')
        const origin = new URL(targetInfo.url || parentWorker?.origin || parentTab?.url || '').origin
        // Owned data/opaque workers can compute, but cannot inherit the page's
        // network approval. Their null origin stays explicitly denied below.
        const owner = { context, origin, targetId: targetInfo.targetId }
        this.workerOwner.set(sessionId, owner)
        this.workerByTarget.set(targetInfo.targetId, owner)
        // A service worker's domains wait for startup. Its browser-level gate
        // already has the exact target owner, so startup requests stay checked.
        if (targetInfo.type === 'service_worker') await resume()
        await cdp.send('Network.enable', {}, sessionId)
        await this.applyWorkerSocketPolicy(sessionId, owner)
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId)
        await resume()
      }
    } catch (error) {
      // Native detach can race domain setup when a short-lived iframe/worker
      // finishes. Its closed session is cancellation, not lost containment.
      if (generation !== this.generation || !this.attachedSessions.has(sessionId)) return
      failed = true
      if (generation === this.generation) void this.shutdown(`target initialization failed: ${error instanceof Error ? error.message : 'unknown error'}`, false)
      throw error
    } finally {
      if (!failed && generation === this.generation && this.attachedSessions.has(sessionId)) await resume()
    }
  }

  /**
   * The request policy. The main frame may only load origins the user approved for this context
   * (clicks and redirects elsewhere are refused and reported). Subframes and subresources may not
   * reach blocked addresses, and a public page may not reach this machine.
   */
  private async allowRequest(tab: Tab, request: { url: string; resourceType: string; frameId?: string }, sessionId = tab.sessionId): Promise<boolean> {
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
    if (classification.kind === 'loopback') {
      const source = await tab.requestOrigin(request.frameId, request.resourceType === 'Document', sessionId)
      return source !== undefined && isLoopbackUrl(source)
    }
    return true
  }

  private async answerFrameRequest(owner: Tab, sessionId: string, params: { requestId: string; request: { url: string }; resourceType: string; frameId?: string }): Promise<void> {
    let allow = false
    try { allow = await this.allowRequest(owner, { url: params.request.url, resourceType: params.resourceType, frameId: params.frameId }, sessionId) } catch { allow = false }
    const cdp = owner.cdp
    await cdp.send(allow ? 'Fetch.continueRequest' : 'Fetch.failRequest', allow ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {})
  }

  private async applyWorkerSocketPolicy(sessionId: string, owner: WorkerOwner): Promise<void> {
    // This CDP setting is not a socket boundary: Chrome can accept it without
    // blocking handshakes. See the explicit socket-network-check security gate.
    const approved = owner.origin !== 'null' && owner.context.approved.has(owner.origin)
    await this.browser?.connection.send('Network.setBlockedURLs', { urls: !approved ? ['ws://*', 'wss://*'] : isLoopbackUrl(owner.origin) ? [] : LOOPBACK_WEBSOCKETS }, sessionId)
  }

  private async allowWorkerRequest(owner: WorkerOwner, url: string): Promise<boolean> {
    if (owner.origin === 'null' || this.contexts.get(owner.context.key) !== owner.context || !owner.context.approved.has(owner.origin)) return false
    const classification = await this.classify(url)
    return classification.kind === 'public' || classification.kind === 'loopback' && isLoopbackUrl(owner.origin)
  }

  /** The proxy rechecks DNS and pins sockets; CDP retains exact HTTP ownership. */
  private async allowContextEgress(context: ContextState | undefined, raw: string, socketOrigin?: string): Promise<boolean> {
    if (!context || this.contexts.get(context.key) !== context || context.approved.size === 0) return false
    const url = new URL(raw)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    if ([...this.egressGates].some(gate => gate.url === url.origin)) return false
    const classification = await this.classify(url.href)
    if (classification.kind === 'blocked') return false
    if (socketOrigin !== undefined) {
      let origin: URL
      try { origin = new URL(socketOrigin) } catch { return false }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== socketOrigin || !context.approved.has(socketOrigin)) return false
      return classification.kind === 'public' || isLoopbackHost(origin.hostname)
    }
    return classification.kind === 'public' || [...context.approved].some(origin => isLoopbackUrl(origin))
  }

  private async answerBrowserRequest(params: { requestId: string; networkId?: string; request: { url: string }; resourceType: string; frameId?: string }): Promise<void> {
    const cdp = this.browser?.connection
    if (!cdp) return
    let allow = false
    try {
      const lookup = (): RequestOwner | undefined => (params.networkId ? this.requestOwner.get(params.networkId) : undefined)
        ?? (params.frameId ? this.workerByTarget.get(params.frameId) : undefined)
        ?? (params.frameId ? this.frameByTarget.get(params.frameId)?.tab : undefined)
        ?? [...this.tabContext.keys()].find(tab => tab.targetId === params.frameId)
      let owner = lookup()
      const deadline = Date.now() + 1000
      while (!owner && params.networkId && Date.now() < deadline && this.browser?.connection === cdp) {
        await new Promise(resolve => setTimeout(resolve, 10))
        owner = lookup()
      }
      if (owner) allow = owner instanceof Tab ? await this.allowRequest(owner, { url: params.request.url, resourceType: params.resourceType, frameId: params.frameId }) : await this.allowWorkerRequest(owner, params.request.url)
    } catch { allow = false }
    await cdp.send(allow ? 'Fetch.continueRequest' : 'Fetch.failRequest', allow ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
  }

  private dropTab(tab: Tab): void {
    const context = this.tabContext.get(tab)
    tab.dispose()
    this.tabContext.delete(tab)
    this.tabBySession.delete(tab.sessionId)
    for (const [target, owner] of this.frameByTarget) if (owner.tab === tab) this.frameByTarget.delete(target)
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
    context.egress.stop()
    this.egressGates.delete(context.egress)
    for (const [sessionId, owner] of this.workerOwner) if (owner.context === context) this.workerOwner.delete(sessionId)
    for (const [targetId, owner] of this.workerByTarget) if (owner.context === context) this.workerByTarget.delete(targetId)
    for (const tab of [...context.tabs]) this.dropTab(tab)
    this.contexts.delete(context.key)
    for (const [id, candidate] of this.byBrowserContextId) if (candidate === context) this.byBrowserContextId.delete(id)
    rmSync(context.downloads, { recursive: true, force: true })
    if (context.browserContextId) void this.browser?.connection.send('Target.disposeBrowserContext', { browserContextId: context.browserContextId }).catch(() => {})
    this.changed()
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private scheduleIdle(): void {
    this.cancelIdle()
    if (!this.browser || this.retained.size) return
    this.idleTimer = setTimeout(() => { if (this.busy === 0) this.shutdown('idle for 5 minutes') }, IDLE_CLOSE_MS)
    this.idleTimer.unref?.()
  }
}

/** The process-wide browser. */
export const browserService = new BrowserService()
