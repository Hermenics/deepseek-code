import { setTimeout as delay } from 'node:timers/promises'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { acquireFileLease } from '../orchestration/fileLease.js'
import { redactSecrets } from '../orchestration/events.js'
import { BotStore, isSqliteBusy } from './store.js'
import { startBotWebServer, type BotWebOptions } from './web.js'
import { randomUUID } from 'node:crypto'
import type { BotBrowserControl } from './browser.js'
import { botWorkerEnvironment } from './environment.js'
import { loadSavedConfig } from '../ui/setup/ApiKeySetup.js'
import { deliverSignedWebhook, WebhookResponseError } from './delivery.js'

/** Local supervisor. Workers isolate process-scoped goal/todo/browser state per bot. */
export async function serveBots(options: { path?: string; concurrency?: number; signal: AbortSignal; entrypoint?: string; web?: BotWebOptions; onWebListening?: (url: string) => void }): Promise<void> {
  const concurrency = options.concurrency ?? 2
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Worker concurrency must be between 1 and 16')
  const entrypoint = options.entrypoint ?? process.argv[1]
  if (!entrypoint) throw new Error('Worker entrypoint is missing')
  const store = await BotStore.open({ path: options.path, busyTimeoutMs: 0 }, options.signal).catch(error => { if (!options.signal.aborted) throw error })
  if (!store) return
  const path = resolve(store.store.path)
  const lease = await acquireFileLease(`bot-service:${path}`, {}, options.signal).catch(error => { store.close(); if (!options.signal.aborted) throw error })
  if (!lease) return
  // The async maintenance loop retries contention; never stall IPC/HTTP for
  // SQLite's synchronous busy timeout while another process holds the writer.
  const workers = new Map<string, ReturnType<typeof Bun.spawn>>()
  const deliveryOwner = `delivery:${process.pid}:${randomUUID()}`
  const deliveries = new Set<Promise<void>>()
  const deliveryControllers = new Set<AbortController>()
  let nextRetentionAt = 0
  const announced = new WeakSet<ReturnType<typeof Bun.spawn>>()
  const announceWorker = (id: string, worker: ReturnType<typeof Bun.spawn>) => {
    if (announced.has(worker)) return
    store.events(id).emit('BotWorkerStarted', { pid: worker.pid })
    announced.add(worker)
  }
  let web: ReturnType<typeof startBotWebServer> | undefined
  const pending = new Map<string, { worker: ReturnType<typeof Bun.spawn>; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const browserControl: BotBrowserControl = async (botId, runId, command, args) => {
    const worker = workers.get(botId), run = store.getRun(runId)
    if (!worker || worker.exitCode !== null || !run.owner?.startsWith(`${worker.pid}:`) || run.botId !== botId || run.testMode || !['running', 'waiting'].includes(run.status)) throw new Error('This agent has no active browser worker')
    if (pending.size >= 32) throw new Error('Browser controls are busy; try again')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser response timed out; refresh its state before acting again')) }, 15_000)
      pending.set(id, { worker, resolve, reject, timer })
      try { worker.send({ type: 'bot-browser-request', id, botId, runId, command, args }) }
      catch { clearTimeout(timer); pending.delete(id); reject(new Error('Browser worker disconnected')) }
    })
  }
  const startDelivery = () => {
    if (deliveries.size >= 4) return
    const job = store.claimDelivery(deliveryOwner)
    if (!job) return
    const controller = new AbortController()
    deliveryControllers.add(controller)
    let operation!: Promise<void>
    operation = (async () => {
      try {
        const privateKeyPem = await store.deliveryPrivateKey(job.target.id)
        const status = await deliverSignedWebhook({ rawUrl: job.target.url, deliveryId: job.record.id, body: job.record.body, privateKeyPem, signal: controller.signal })
        if (!controller.signal.aborted) store.completeDelivery(job.record.id, deliveryOwner, { status })
      } catch (error) {
        if (!controller.signal.aborted) {
          try {
            store.completeDelivery(job.record.id, deliveryOwner, error instanceof WebhookResponseError
              ? { status: error.status, error: error.message }
              : { error: error instanceof Error ? error.message : String(error) })
          } catch { /* The delivery lease expires and the next supervisor safely retries it. */ }
        }
      } finally {
        deliveryControllers.delete(controller)
        deliveries.delete(operation)
      }
    })()
    deliveries.add(operation)
  }
  try {
    if (options.web) { web = startBotWebServer(store, options.web, browserControl); options.onWebListening?.(web.url) }
    while (!options.signal.aborted) {
      try {
        store.recover()
        store.dispatchDue()
        if (Date.now() >= nextRetentionAt) {
          try { await store.applyDataRetention(); nextRetentionAt = Date.now() + 60 * 60_000 }
          catch (error) { nextRetentionAt = Date.now() + 1_000; throw error }
        }
        while (deliveries.size < 4) {
          const before = deliveries.size
          startDelivery()
          if (deliveries.size === before) break
        }
        // A process handle, rather than its saved PID/status, proves a worker is still live.
        for (const [id, worker] of workers) {
          announceWorker(id, worker)
          if (worker.exitCode === null) continue
          for (const [key, request] of pending) if (request.worker === worker) { clearTimeout(request.timer); pending.delete(key); request.reject(new Error('Browser worker exited')) }
          for (const run of store.listRuns(id)) {
            if (run.owner?.startsWith(`${worker.pid}:`)) store.acknowledgeStop(run.id, run.owner)
          }
          store.events(id).emit('BotWorkerExited', { pid: worker.pid, exitCode: worker.exitCode })
          workers.delete(id)
        }
        for (const bot of store.listBots()) {
          if (workers.size >= concurrency) break
          if (!bot.enabled || workers.has(bot.id)) continue
          if (store.unreconciledRuns(bot.id).length) continue
          if (!store.store.query("SELECT id FROM bot_runs WHERE bot_id = ? AND status = 'queued' LIMIT 1", bot.id).length) continue
          const directory = join(dirname(path), 'actors', bot.id)
          mkdirSync(directory, { recursive: true, mode: 0o700 })
          const log = openSync(join(directory, 'worker.log'), 'a', 0o600)
          try {
            const { providerConfig } = await loadSavedConfig()
            const workerEnv = botWorkerEnvironment(process.env, { provider: providerConfig?.provider, remoteBrowser: Boolean(web) })
            const worker = Bun.spawn([process.execPath, resolve(entrypoint), '--bot-worker', path, bot.id], {
              cwd: bot.projectRoot, env: workerEnv, stdin: 'ignore', stdout: log, stderr: log,
              ipc(message, worker) {
                if (!message || message.type !== 'bot-browser-response' || typeof message.id !== 'string') return
                const request = pending.get(message.id)
                if (!request || request.worker !== worker) return
                clearTimeout(request.timer); pending.delete(message.id)
                if (message.error) request.reject(new Error('Browser request failed. Refresh its state and check that this run is still active.'))
                else request.resolve(message.result)
              },
            })
            workers.set(bot.id, worker)
            announceWorker(bot.id, worker)
          } finally { closeSync(log) }
        }
      } catch (error) {
        // Busy means another writer still owns SQLite. Yield before the next
        // maintenance pass; live process handles prevent duplicate launches.
        if (!isSqliteBusy(error)) throw error
      }
      await delay(500, undefined, { signal: options.signal })
    }
  } catch (error) {
    if (!options.signal.aborted) {
      store.events('service').emit('BotServiceError', { error: redactSecrets(error instanceof Error ? error.message : String(error)) })
      throw error
    }
  } finally {
    web?.server.stop(true)
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Bot service stopped')) }
    pending.clear()
    for (const controller of deliveryControllers) controller.abort(new Error('Bot service stopped'))
    for (const worker of workers.values()) if (worker.exitCode === null) worker.kill('SIGTERM')
    const settled = Promise.allSettled([...workers.values()].map(worker => worker.exited))
    const deadline = new AbortController()
    await Promise.race([settled, delay(10_000, undefined, { signal: deadline.signal })]).finally(() => deadline.abort())
    for (const worker of workers.values()) if (worker.exitCode === null) worker.kill('SIGKILL')
    await settled
    await Promise.allSettled([...deliveries])
    store.close(); await lease.release()
  }
}
