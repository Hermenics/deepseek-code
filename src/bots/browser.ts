import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { browserService, contextKey } from '../browser/service.js'
import { KEYS } from '../browser/tab.js'
import type { BotRun } from './types.js'
import type { BotStore } from './store.js'

export type BotBrowserControl = (botId: string, runId: string, command: string, args?: Record<string, unknown>) => Promise<unknown>

/** Private worker IPC: screenshots/typed secrets go to the authenticated operator, never to the model or logs. */
export function installBotBrowserControl(store: BotStore, run: BotRun, owner: string, signal: AbortSignal) {
  const key = contextKey(store.browserSessionIdentity(run))
  const write = <T>(operation: () => T) => store.writeOwned(run.id, owner, operation, signal)
  let held = false, queue = Promise.resolve(), view: { id: string; width: number; height: number } | null = null
  let releaseRetention: (() => void) | undefined
  const hold = () => { held = true; releaseRetention ??= browserService.retain(key) }
  const unhold = () => { held = false; releaseRetention?.(); releaseRetention = undefined }
  const wait = async () => { while (held) { assertLive(); await delay(100, undefined, { signal }) } }
  const assertLive = () => {
    const current = store.getRun(run.id)
    if (signal.aborted || current.owner !== owner || !['running', 'waiting'].includes(current.status) || (current.leaseUntil ?? 0) <= Date.now()) throw new Error('This browser run is no longer active')
  }
  const status = () => ({ ...browserService.status(), held, runId: run.id, dialog: browserService.currentDialog(key) })
  const operation = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    assertLive()
    if (command === 'status') return status()
    if (command === 'release') {
      if (browserService.status().running) await browserService.withTab(key, async () => { browserService.clearHumanActivity(key) })
      unhold(); view = null; await write(() => store.events(run.botId).emit('BotBrowserReturned', { runId: run.id })); return status()
    }
    if (command === 'take') {
      hold(); view = null
      try { await browserService.withTab(key, async () => { assertLive() }) }
      catch (error) { unhold(); throw error }
      await write(() => store.events(run.botId).emit('BotBrowserTaken', { runId: run.id }))
      return status()
    }
    if (command !== 'image' && !held) throw new Error('Take over the browser before acting on it')
    if (!browserService.status().running) throw new Error('The browser is closed; take over to open Codimium')
    return browserService.withTab(key, async tab => {
      assertLive()
      if (command === 'image') {
        const { cssVisualViewport } = await tab.cdp.send<{ cssVisualViewport: { clientWidth: number; clientHeight: number } }>('Page.getLayoutMetrics', {}, tab.sessionId)
        view = { id: randomUUID(), width: cssVisualViewport.clientWidth, height: cssVisualViewport.clientHeight }
        return { ...view, image: await tab.screenshot(), held, runId: run.id }
      }
      const number = (field: string, min: number, max: number) => {
        const value = args[field]
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid browser ${field}`)
        return value
      }
      const text = (field: string, max: number) => {
        if (typeof args[field] !== 'string' || (args[field] as string).length > max) throw new Error(`Invalid browser ${field}`)
        return args[field] as string
      }
      if (!['navigate', 'click', 'type', 'press', 'scroll', 'tab', 'dialog'].includes(command)) throw new Error('Unknown browser command')
      let url: string | undefined, x = 0, y = 0, input = '', index = 0, delta = 0
      if (command === 'navigate') {
        url = text('url', 4096)
        const classification = await browserService.classifyUrl(url)
        if (classification.kind === 'blocked' || !classification.origin) throw new Error('Browser URL is blocked')
        browserService.approve(key, classification.origin)
      }
      if (command === 'click') {
        if (!view || args.viewId !== view.id) throw new Error('The browser image changed; refresh before clicking')
        x = number('x', 0, view.width); y = number('y', 0, view.height)
      }
      if (command === 'type') input = text('text', 16000)
      if (command === 'press') { input = text('key', 32); if (!Object.hasOwn(KEYS, input)) throw new Error('Unsupported browser key') }
      if (command === 'tab') {
        index = number('index', 0, 99)
        if (!Number.isInteger(index) || !browserService.status().contexts.find(context => context.key === key)?.tabs[index]) throw new Error('No such browser tab')
      }
      if (command === 'scroll') delta = number('delta', -1600, 1600)
      if (command === 'dialog' && typeof args.accept !== 'boolean') throw new Error('Dialog answer must be true or false')
      if (command === 'dialog' && !browserService.currentDialog(key)) throw new Error('No browser dialog is open')
      if (command === 'dialog' && args.text !== undefined) input = text('text', 16000)
      // Record only the action kind; credentials, screenshots and raw keys never enter this journal.
      const action = await write(() => store.beginAction(run.id, owner, 'human_browser', { command }, false))
      view = null
      if (command === 'navigate') { await tab.navigate(url!); await browserService.applyTabPolicy(tab) }
      if (command === 'click') await tab.click(x, y)
      if (command === 'type') await tab.cdp.send('Input.insertText', { text: input }, tab.sessionId)
      if (command === 'press') await tab.press(input)
      if (command === 'scroll') await tab.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY: delta }, tab.sessionId)
      if (command === 'tab') browserService.selectTab(key, index)
      if (command === 'dialog') await tab.cdp.send('Page.handleJavaScriptDialog', { accept: args.accept, ...(args.text === undefined ? {} : { promptText: input }) }, tab.sessionId)
      await tab.settle(signal)
      assertLive()
      await write(() => {
        store.completeAction(action, 'The authenticated operator completed a browser action.', owner)
        store.events(run.botId).emit('BotHumanBrowserAction', { runId: run.id, command })
      })
      return status()
    })
  }
  const listener = (message: unknown) => {
    if (!message || typeof message !== 'object') return
    const request = message as Record<string, unknown>
    if (request.type !== 'bot-browser-request' || request.botId !== run.botId || request.runId !== run.id || typeof request.id !== 'string' || typeof request.command !== 'string') return
    const execute = async () => {
      let response: Record<string, unknown>
      try { response = { result: await operation(request.command as string, request.args as Record<string, unknown> | undefined) } }
      catch { response = { error: 'Browser request failed. Refresh its state and check that this run is still active.' } }
      try { if (process.connected) process.send?.({ type: 'bot-browser-response', id: request.id, ...response }) } catch { /* supervisor already disconnected */ }
    }
    queue = queue.then(execute, execute)
  }
  process.on('message', listener)
  return {
    wait,
    hold,
    release: () => operation('release'),
    async dispose() { process.off('message', listener); try { await queue } finally { unhold(); view = null } },
  }
}
