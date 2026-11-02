import { request } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { sign } from 'node:crypto'
import { classifyUrl, systemResolver, type Resolver } from '../browser/policy.js'

const MAX_URL_LENGTH = 2048
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 8192

export interface ValidatedWebhookTarget {
  url: URL
  addresses: string[]
}

/** Webhook receivers must be HTTPS and publicly routed. Every DNS answer is checked. */
export async function validateWebhookTarget(raw: string, resolve: Resolver = systemResolver): Promise<ValidatedWebhookTarget> {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) throw new Error('Webhook URL must be at most 2048 characters')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Webhook URL is invalid') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#')) throw new Error('Webhook targets must use HTTPS and cannot contain credentials, query parameters or fragments')
  if (url.port && url.port !== '443') throw new Error('Webhook targets must use the standard HTTPS port 443')
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!host || host === 'metadata.google.internal') throw new Error('Webhook host is not allowed')
  const addresses = isIP(host) ? [host] : await resolve(host)
  const classified = await classifyUrl(url.href, async requested => requested === host ? addresses : [])
  if (classified.kind !== 'public' || !addresses.length) throw new Error(`Webhook target is blocked: ${classified.reason ?? 'host is not publicly routable'}`)
  return { url, addresses }
}

export interface WebhookPostInput {
  url: URL
  addresses: string[]
  body: string
  headers: Record<string, string>
  signal?: AbortSignal
}
export type WebhookPost = (input: WebhookPostInput) => Promise<number>

/** Send a signed event to one pinned public IP; redirects are returned to the caller, never followed. */
export async function deliverSignedWebhook(input: {
  rawUrl: string
  deliveryId: string
  body: string
  privateKeyPem: string
  signal?: AbortSignal
}, options: { resolve?: Resolver; post?: WebhookPost; now?: number } = {}): Promise<number> {
  const target = await validateWebhookTarget(input.rawUrl, options.resolve)
  input.signal?.throwIfAborted()
  const timestamp = String(Math.floor((options.now ?? Date.now()) / 1000))
  const signature = sign(null, Buffer.from(`${timestamp}.${input.body}`), input.privateKeyPem).toString('base64')
  const status = await (options.post ?? postPinnedHttps)({
    url: target.url,
    addresses: target.addresses,
    body: input.body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'DeepSeek-Bot-Webhook/1',
      'x-deepseek-delivery-id': input.deliveryId,
      'x-deepseek-delivery-signature': `t=${timestamp},ed25519=${signature}`,
    },
    signal: input.signal,
  })
  if (!Number.isInteger(status) || status < 200 || status >= 300) throw new WebhookResponseError(status)
  return status
}

export class WebhookResponseError extends Error {
  constructor(readonly status: number) { super(`Webhook returned HTTP ${status || 'no response'}`) }
}

const postPinnedHttps: WebhookPost = ({ url, addresses, body, headers, signal }) => new Promise((resolve, reject) => {
  if (!addresses.length) { reject(new Error('No pinned webhook address')); return }
  let responseBytes = 0
  let settled = false
  const finish = (error?: Error, status?: number) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    error ? reject(error) : resolve(status ?? 0)
  }
  const timer = setTimeout(() => req.destroy(new Error('Webhook request timed out')), REQUEST_TIMEOUT_MS)
  timer.unref?.()
  const address = addresses[0]!
  const family = isIP(address)
  if (!family) { finish(new Error('Pinned webhook address is invalid')); return }
  const lookup: LookupFunction = (hostname, options, callback) => {
    if (hostname.replace(/^\[|\]$/g, '').toLowerCase() !== url.hostname.replace(/^\[|\]$/g, '').toLowerCase()) {
      callback(Object.assign(new Error('Webhook resolver hostname changed'), { code: 'EAI_AGAIN' }), '', family)
      return
    }
    if (typeof options === 'object' && options !== null && options.all) {
      callback(null, addresses.map(value => ({ address: value, family: isIP(value) })))
      return
    }
    callback(null, address, family)
  }
  const req = request(url, {
    method: 'POST',
    headers: { ...headers, host: url.host, 'content-length': Buffer.byteLength(body) },
    lookup,
    signal,
    timeout: REQUEST_TIMEOUT_MS,
  }, response => {
    response.on('data', chunk => {
      responseBytes += Buffer.byteLength(chunk)
      if (responseBytes > MAX_RESPONSE_BYTES) response.destroy(new Error('Webhook response exceeded the size limit'))
    })
    response.on('error', error => finish(error instanceof Error ? error : new Error('Webhook response failed')))
    response.on('end', () => finish(undefined, response.statusCode ?? 0))
  })
  req.on('error', error => finish(error))
  req.end(body)
})
