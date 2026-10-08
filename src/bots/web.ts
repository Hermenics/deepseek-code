import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { redactSecrets } from '../orchestration/events.js'
import { BotEventQueueFullError, BotEventRateLimitError, BotStore, isSqliteBusy } from './store.js'
import { BOT_PANEL_HTML } from './panel.js'
import { POD_LOGO } from './pod-logo.js'
import { POD_FONT } from './pod-font.js'
import type { PodAppearance } from './types.js'
import type { BotBrowserControl } from './browser.js'
import { procedureSkill } from './procedures.js'

export interface BotWebOptions { hostname?: string; port?: number; publicUrl?: string; token?: string; webhookRateLimit?: { maxEvents: number; windowMs: number } }
const SESSION_MS = 12 * 60 * 60_000
const digest = (value: string) => createHash('sha256').update(value).digest()

/** The authenticated panel controls the same durable queue as the terminal client. */
export function startBotWebServer(store: BotStore, options: BotWebOptions = {}, browserControl?: BotBrowserControl) {
  const token = options.token ?? process.env.DEEPSEEK_BOTS_TOKEN
  if (!token || token.length < 32 || token.length > 1024 || token.trim() !== token) throw new Error('Set DEEPSEEK_BOTS_TOKEN to a private random token of at least 32 characters before enabling the panel')
  const webhookRateLimit = options.webhookRateLimit ?? { maxEvents: 120, windowMs: 60_000 }
  if (!Number.isSafeInteger(webhookRateLimit.maxEvents) || webhookRateLimit.maxEvents < 1 || webhookRateLimit.maxEvents > 1_000_000 || !Number.isSafeInteger(webhookRateLimit.windowMs) || webhookRateLimit.windowMs < 1000 || webhookRateLimit.windowMs > 86_400_000) throw new Error('Webhook rate limit must allow 1 to 1,000,000 events in a window from one second to one day')
  const tokenHash = digest(token), hostname = options.hostname ?? '127.0.0.1', port = options.port ?? 8787
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Panel port must be between 0 and 65535')
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(hostname)
  let origin = options.publicUrl ? new URL(options.publicUrl) : undefined
  if (origin && (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol))) throw new Error('Panel public URL must be an HTTP(S) origin without a path or credentials')
  if (!loopback && origin?.protocol !== 'https:') throw new Error('Remote panels require an explicit HTTPS public URL and a TLS reverse proxy')
  if (origin?.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('HTTP panel access is limited to loopback; use HTTPS remotely')
  const sessions = new Map<string, number>()
  const attempts = new Map<string, { count: number; until: number }>()
  const cookieName = origin?.protocol === 'https:' ? '__Host-deepseek_bots' : 'deepseek_bots'
  const matches = (value: unknown) => typeof value === 'string' && value.length <= 1024 && timingSafeEqual(digest(value), tokenHash)
  const sessionKey = (request: Request) => /(?:^|;\s*)(?:__Host-)?deepseek_bots=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1]
  const cookie = (value: string, age: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${origin?.protocol === 'https:' ? '; Secure' : ''}`
  const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(redactSecrets(data), { status, headers })
  const body = async (request: Request): Promise<Record<string, unknown>> => {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('Send an application/json request')
    let value: unknown
    try { value = await request.json() } catch { throw new Error('Request must contain valid JSON') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request must be a JSON object')
    return value as Record<string, unknown>
  }
  const string = (data: Record<string, unknown>, key: string) => {
    if (typeof data[key] !== 'string') throw new Error(`${key} must be text`)
    return data[key] as string
  }
  const boolean = (data: Record<string, unknown>, key: string) => {
    if (typeof data[key] !== 'boolean') throw new Error(`${key} must be true or false`)
    return data[key] as boolean
  }
  const handle = async (request: Request, server: Bun.Server<undefined>): Promise<Response> => {
    const url = new URL(request.url), method = request.method
    // Host validation also prevents a malicious domain rebinding to this loopback listener.
    const host = new URL(`${origin!.protocol}//${request.headers.get('host') ?? url.host}`)
    if (host.host !== origin!.host || host.username || host.password || host.pathname !== '/' || host.search || host.hash) return json({ error: 'Unexpected panel host' }, 403)
    if (method === 'GET' && url.pathname === '/geist.woff2') return new Response(POD_FONT, { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=86400' } })
    if (method === 'GET' && url.pathname === '/logo.png') return new Response(POD_LOGO, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } })
    if (method === 'GET' && url.pathname === '/') {
      const nonce = randomBytes(18).toString('base64')
      return new Response(BOT_PANEL_HTML.replaceAll('__NONCE__', nonce), { headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      } })
    }
    if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const bearer = request.headers.get('authorization')?.startsWith('Bearer ') ? request.headers.get('authorization')!.slice(7) : undefined
    const tokenAccess = matches(bearer)
    let webhookAccess = false
    if (method === 'POST' && parts[1] === 'bots' && parts[2] && parts[3] === 'events' && parts[4] && /^[a-zA-Z0-9._:-]{1,128}$/.test(parts[4])) {
      try {
        webhookAccess = store.authorizeWebhook(parts[2], parts[4], bearer)
        if (!webhookAccess) {
          const signature = request.headers.get('x-deepseek-signature')
          if (signature) webhookAccess = store.authorizeWebhookSignature(parts[2], parts[4], new Uint8Array(await request.clone().arrayBuffer()), signature)
        }
      } catch { webhookAccess = false }
    }
    if (!['GET', 'HEAD'].includes(method)) {
      const suppliedOrigin = request.headers.get('origin')
      const webhookDelivery = method === 'POST' && parts[1] === 'bots' && parts[2] && parts[3] === 'events' && parts.length === 5
      if (webhookDelivery && suppliedOrigin === null && !webhookAccess) return json({ error: 'A valid bot/topic webhook credential is required' }, 401)
      if (suppliedOrigin !== origin!.origin && !((tokenAccess || webhookAccess) && suppliedOrigin === null)) return json({ error: 'Request origin is not allowed' }, 403)
    }
    const time = Date.now()
    for (const [key, expiry] of sessions) if (expiry <= time) sessions.delete(key)
    if (method === 'POST' && url.pathname === '/api/login') {
      const ip = server.requestIP(request)?.address ?? 'unknown'
      for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key)
      const prior = attempts.get(ip)
      if (prior && prior.count >= 10 || attempts.size >= 1024 && !prior) return json({ error: 'Too many login attempts. Try again in a minute.' }, 429, { 'retry-after': '60' })
      const input = await body(request)
      if (!matches(input.token)) {
        attempts.set(ip, { count: (prior?.count ?? 0) + 1, until: prior?.until ?? time + 60_000 })
        return json({ error: 'Access token is incorrect' }, 401)
      }
      attempts.delete(ip)
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!)
      const key = randomBytes(32).toString('hex')
      sessions.set(key, time + SESSION_MS)
      return json({ ok: true }, 200, { 'set-cookie': cookie(key, SESSION_MS / 1000) })
    }
    const key = sessionKey(request)
    const sessionAccess = !!(key && (sessions.get(key) ?? 0) > time)
    if (!tokenAccess && !webhookAccess && !sessionAccess) return json({ error: 'Sign in to manage your agents' }, 401)
    if (method === 'POST' && url.pathname === '/api/logout') {
      if (key) sessions.delete(key)
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) })
    }
    if (parts[1] === 'groups') {
      if (parts.length === 2 && method === 'GET') return json({ groups: store.listGroups() })
      if (parts.length === 2 && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).some(key => !['name', 'botIds', 'shareBrowser'].includes(key)) || !Array.isArray(input.botIds) || input.botIds.some(id => typeof id !== 'string') || input.shareBrowser !== undefined && typeof input.shareBrowser !== 'boolean') throw new Error('Group creation accepts name, botIds and an optional boolean shareBrowser')
        return json(store.createGroup({ name: string(input, 'name'), botIds: input.botIds as string[], shareBrowser: input.shareBrowser as boolean | undefined }), 201)
      }
      // Allow retries after filesystem cleanup failed and the group is marked
      // deleting; getGroup intentionally hides groups in that intermediate state.
      if (parts[2] && parts.length === 4 && parts[3] === 'delete' && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).length !== 1) throw new Error('Group deletion accepts only the confirmation field')
        return json(await store.deleteGroup(parts[2], string(input, 'confirmation')))
      }
      if (parts[2]) {
        if (parts.length === 3 && method === 'GET') {
          const group = store.getGroup(parts[2], true)
          if (group.deleting) return json({ group, messages: [], artifacts: [], runs: [] })
          return json({ group, messages: store.groupMessages(group.id), artifacts: store.groupArtifactsForUser(group.id), runs: store.groupRuns(group.id).map(run => ({ id: run.id, botId: run.botId, groupMessageId: run.groupMessageId, status: run.status, attempt: run.attempt, updatedAt: run.updatedAt, error: run.error })) })
        }
        const group = store.getGroup(parts[2])
        if (parts.length === 4 && parts[3] === 'messages' && method === 'POST') {
          const input = await body(request)
          if (Object.keys(input).some(key => !['message', 'messageId', 'recipients'].includes(key)) || input.recipients !== undefined && (!Array.isArray(input.recipients) || input.recipients.some(id => typeof id !== 'string'))) throw new Error('Group messages accept message, messageId and optional recipient bot IDs')
          return json(store.sendGroupMessage(group.id, string(input, 'message'), string(input, 'messageId'), input.recipients as string[] | undefined), 202)
        }
        if (parts.length === 5 && parts[3] === 'artifacts' && method === 'GET') return json(store.readGroupArtifactForUser(group.id, parts[4]!))
      }
    }
    if (url.pathname === '/api/bots') {
      if (method === 'GET') return json({ bots: store.listBots().map(bot => ({ ...bot, latestRun: store.listRuns(bot.id, 1)[0] ?? null, activeStatus: store.activeStatus(bot.id) })), service: { running: true } })
      if (method === 'POST') {
        const input = await body(request)
        return json(store.createBot({ name: string(input, 'name'), projectRoot: string(input, 'projectRoot'), instructions: string(input, 'instructions'), appearance: input.appearance as PodAppearance | undefined, agentConfig: input.agentConfig === undefined ? undefined : string(input, 'agentConfig'), reviewerModel: input.reviewerModel === undefined || input.reviewerModel === null || input.reviewerModel === '' ? undefined : string(input, 'reviewerModel') }), 201)
      }
    }
    if (parts[1] === 'bots' && parts[2]) {
      if (method === 'POST' && parts[3] === 'delete' && parts.length === 4) {
        const input = await body(request)
        if (Object.keys(input).some(key => key !== 'confirmation')) throw new Error('Bot deletion accepts only the confirmation field')
        return json(await store.deleteBot(parts[2], string(input, 'confirmation')))
      }
      const bot = store.getBot(parts[2])
      if (parts[3] === 'appearance' && parts.length === 4 && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'appearance')) throw new Error('Appearance accepts only the appearance field')
        return json(store.setAppearance(bot.id, input.appearance))
      }
      if (parts[3] === 'reviewer-model' && parts.length === 4 && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).length !== 1 || !(input.model === null || typeof input.model === 'string')) throw new Error('Reviewer model accepts only a model ID or null to use the pod model')
        return json(store.setReviewerModel(bot.id, input.model as string | null))
      }
      if (parts[3] === 'retention' && parts.length === 4) {
        if (method === 'GET') return json({ retentionDays: bot.retentionDays })
        if (method === 'POST') {
          const input = await body(request)
          if (Object.keys(input).length !== 1 || !(input.days === null || Number.isSafeInteger(input.days))) throw new Error('Retention accepts only days: null or a whole number')
          return json(store.setRetentionDays(bot.id, input.days as number | null))
        }
      }
      if (parts[3] === 'deliveries' && parts.length === 4) {
        if (method === 'GET') return json({
          targets: store.deliveryTargets(bot.id),
          history: store.deliveryHistory(bot.id).map(({ body: _body, ...record }) => record),
        })
        if (method === 'POST') {
          const input = await body(request)
          if (Object.keys(input).some(key => key !== 'url' && key !== 'topics') || !Array.isArray(input.topics) || input.topics.some(topic => typeof topic !== 'string')) throw new Error('Delivery creation accepts only url and topics')
          return json(await store.addDeliveryTarget(bot.id, string(input, 'url'), input.topics as string[]), 201)
        }
      }
      if (parts[3] === 'deliveries' && parts[4] && parts.length === 6 && parts[5] === 'delete' && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).length) throw new Error('Delivery target removal does not accept fields')
        return json({ removed: await store.deleteDeliveryTarget(bot.id, parts[4]) })
      }
      if (parts[3] === 'deliveries' && parts[4] && parts.length === 6 && parts[5] === 'enabled' && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).length !== 1 || typeof input.enabled !== 'boolean') throw new Error('Delivery target control accepts only a boolean enabled field')
        return json(store.setDeliveryTargetEnabled(bot.id, parts[4], input.enabled))
      }
      if (parts[3] === 'deliveries' && parts[4] && parts.length === 6 && parts[5] === 'retry' && method === 'POST') {
        const input = await body(request)
        if (Object.keys(input).length) throw new Error('Delivery retry does not accept fields')
        const { body: _body, ...record } = store.retryDelivery(bot.id, parts[4])
        return json(record)
      }
      if (method === 'POST' && parts[3] === 'events' && parts.length === 5) {
        // A hook key can only deliver its own topic to its own bot.
        if (!webhookAccess) return json({ error: 'A valid bot/topic webhook credential is required' }, 401)
        const topic = parts[4]!
        if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(topic)) throw new Error('Event topic must use letters, numbers, dot, underscore, colon or hyphen')
        const input = await body(request)
        if (!Object.hasOwn(input, 'payload')) throw new Error('payload is required')
        const eventId = string(input, 'eventId')
        const runs = store.dispatchEvent(topic, eventId, input.payload, bot.id, webhookRateLimit)
        return json({ botId: bot.id, topic, eventId, runIds: runs.map(run => run.id) }, 202)
      }
      if (method === 'GET' && parts[3] === 'webhooks' && parts.length === 4) return json(store.webhookCredentials(bot.id))
      if (method === 'GET' && parts[3] === 'export' && parts.length === 4) {
        const filename = `deepseek-bot-${bot.id}.json`
        return new Response(JSON.stringify(store.exportBot(bot.id), null, 2), { headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
        } })
      }
      if (method === 'POST' && parts[3] === 'webhooks' && parts.length === 5) {
        const topic = parts[4]!, input = await body(request)
        if (Object.keys(input).length) throw new Error('Webhook credential rotation does not accept request fields')
        const issued = store.rotateWebhookCredential(bot.id, topic)
        // This one-time management response intentionally includes the new random secret.
        return Response.json(issued, { status: 201 })
      }
      if (method === 'POST' && parts[3] === 'webhooks' && parts.length === 6 && parts[5] === 'revoke') {
        const input = await body(request)
        if (Object.keys(input).length) throw new Error('Webhook revocation does not accept request fields')
        return json({ revoked: store.revokeWebhookCredential(bot.id, parts[4]!) })
      }
      if (parts[3] === 'browser' && parts.length === 4) {
        if (!browserControl) return json({ error: 'Browser control is available through the bot supervisor' }, 409)
        if (method === 'GET') {
          const run = store.listRuns(bot.id).find(r => ['running', 'waiting'].includes(r.status))
          if (!run) return json({ running: false, held: false, runId: null, contexts: [] })
          if (run.testMode) return json({ error: 'Codimium is unavailable during a safe routine test' }, 409)
          return json(await browserControl(bot.id, run.id, 'status'))
        }
        if (method === 'POST') {
          const input = await body(request), runId = string(input, 'runId'), command = string(input, 'command')
          if (!['take', 'release', 'image', 'navigate', 'click', 'type', 'press', 'scroll', 'tab', 'dialog'].includes(command)) throw new Error('Unknown browser command')
          const args = input.args
          if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) throw new Error('Browser arguments must be an object')
          return json(await browserControl(bot.id, runId, command, args as Record<string, unknown> | undefined))
        }
      }
      if (method === 'GET' && parts.length === 3) return json({ bot, ...store.conversation(bot.id), unreconciledRuns: store.unreconciledRuns(bot.id) })
      if (method === 'GET' && parts.length === 4 && parts[3] === 'history') {
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 10
        return json(store.searchHistory(bot.id, url.searchParams.get('query') ?? '', limit))
      }
      if (method === 'GET' && parts[3] === 'routines' && parts.length === 6 && parts[5] === 'runs') return json(store.routineRuns(bot.id, parts[4]!))
      if (method === 'GET' && parts[3] === 'procedures' && parts.length === 5) return new Response(procedureSkill(store.getProcedure(bot.id, parts[4]!)), { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="SKILL.md"' } })
      if (method === 'GET' && parts[3] === 'events' && parts.length === 4) {
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isSafeInteger(after) || after < 0) throw new Error('after must be a nonnegative event sequence')
        return json(store.events(bot.id).query({ after_seq: after, limit: 250 }))
      }
      if (method === 'POST') {
        const input = await body(request)
        if (parts[3] === 'notes') {
          const expiresAt = input.expiresAt === undefined || input.expiresAt === null ? null : input.expiresAt as number
          if (parts.length === 4) return json(store.addNote(bot.id, string(input, 'content'), string(input, 'source'), expiresAt), 201)
          if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) throw new Error('Current note version is required')
          if (parts.length === 5) return json(store.updateNote(bot.id, parts[4]!, string(input, 'content'), string(input, 'source'), expiresAt, input.version as number))
          if (parts.length === 6 && parts[5] === 'remove') return json({ removed: store.removeNote(bot.id, parts[4]!, input.version as number) })
        }
        if (parts[3] === 'messages' && parts.length === 4) return json(store.enqueue(bot.id, string(input, 'message'), 'user', string(input, 'occurrenceId')), 201)
        if (parts[3] === 'enabled' && parts.length === 4) { store.setEnabled(bot.id, boolean(input, 'enabled')); return json(store.getBot(bot.id)) }
        if (parts[3] === 'procedures' && parts.length === 4) return json(store.learnProcedure(bot.id, string(input, 'runId'), string(input, 'name')), 201)
        if (parts[3] === 'routines' && parts.length === 4) return json(store.addRoutine(bot.id, { name: string(input, 'name'), prompt: string(input, 'prompt'), schedule: input.schedule, idempotencyKey: string(input, 'occurrenceId'), procedureId: input.procedureId === undefined ? undefined : string(input, 'procedureId'), procedureInputs: input.procedureInputs }), 201)
        if (parts[3] === 'routines' && parts.length === 6 && parts[5] === 'run') return json(store.runRoutineNow(bot.id, parts[4]!, string(input, 'occurrenceId')), 202)
        if (parts[3] === 'routines' && parts.length === 6 && parts[5] === 'test') return json(store.testRoutineNow(bot.id, parts[4]!, string(input, 'occurrenceId')), 202)
        if (parts[3] === 'routines' && parts.length === 6 && parts[5] === 'delete') {
          if (!Number.isSafeInteger(input.version) || Number(input.version) < 1) throw new Error('Current routine version is required')
          return json({ deleted: store.deleteRoutine(bot.id, parts[4]!, input.version as number) })
        }
        if (parts[3] === 'routines' && parts.length === 5) {
          if (!store.routines(bot.id).some(r => r.id === parts[4])) throw new Error('Routine does not belong to this bot')
          if (Object.hasOwn(input, 'enabled')) {
            if (Object.keys(input).some(key => !['enabled', 'version'].includes(key))) throw new Error('Routine control accepts only enabled and version')
            return json(store.setRoutineEnabled(parts[4]!, boolean(input, 'enabled'), input.version as number | undefined))
          }
          return json(store.updateRoutine(bot.id, parts[4]!, {
            name: string(input, 'name'), prompt: string(input, 'prompt'), schedule: input.schedule,
            procedureId: !Object.hasOwn(input, 'procedureId') ? undefined : input.procedureId === null || input.procedureId === '' ? null : string(input, 'procedureId'),
            procedureInputs: input.procedureInputs, expectedVersion: input.version as number,
          }))
        }
      }
    }
    if (method === 'POST' && parts[1] === 'runs' && parts.length === 4) {
      const id = parts[2]!, input = await body(request)
      if (parts[3] === 'messages') return json(store.steer(id, string(input, 'message'), string(input, 'messageId')), 201)
      if (parts[3] === 'cancel') store.cancel(id)
      else if (parts[3] === 'retry') store.retry(id, input.reconciled === undefined ? false : boolean(input, 'reconciled'))
      else if (parts[3] === 'reconcile') store.reconcile(id, string(input, 'evidence'))
      else return json({ error: 'Not found' }, 404)
      return json(store.getRun(id))
    }
    if (method === 'GET' && parts[1] === 'runs' && parts.length === 4 && parts[3] === 'transcript') {
      const run = store.getRun(parts[2]!)
      return json({ runId: run.id, messages: store.transcript(run.botId, run.id) })
    }
    if (method === 'POST' && parts[1] === 'decisions' && parts.length === 3) {
      const input = await body(request)
      store.answerDecision(parts[2]!, string(input, 'fingerprint'), input.answer)
      return json(store.getDecision(parts[2]!))
    }
    return json({ error: 'Not found' }, 404)
  }
  // Panel reads remain available in WAL; a contended write must yield rather
  // than block every request on the server's JS thread.
  store.store.exec('PRAGMA busy_timeout = 0')
  const server = Bun.serve({ hostname, port, maxRequestBodySize: 131072, async fetch(request, server) {
    let response: Response
    try { response = await handle(request, server) }
    catch (error) { response = error instanceof BotEventRateLimitError
      ? json({ error: error.message, code: error.code }, 429, { 'retry-after': String(error.retryAfterSeconds) })
      : error instanceof BotEventQueueFullError
      ? json({ error: error.message, code: error.code }, 429, { 'retry-after': '10' })
      : isSqliteBusy(error)
      ? json({ error: 'Database is busy; retry this request.', code: 'database_busy' }, 503, { 'retry-after': '1' })
      : json({ error: error instanceof Error ? error.message : 'Panel request failed' }, 400) }
    response.headers.set('cache-control', 'no-store')
    response.headers.set('x-content-type-options', 'nosniff')
    response.headers.set('referrer-policy', 'no-referrer')
    return response
  } })
  origin ??= new URL(`http://${hostname === '::1' ? '[::1]' : hostname}:${server.port}`)
  return { server, url: origin.origin }
}
