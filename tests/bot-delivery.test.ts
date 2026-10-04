import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPairSync, verify } from 'node:crypto'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../src/bots/store.js'
import { deliverSignedWebhook, validateWebhookTarget, type WebhookPost } from '../src/bots/delivery.js'

const stores: BotStore[] = [], directories: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const resolver = async () => ['93.184.216.34']

describe('signed outbound webhook delivery', () => {
  it('pins the destination, signs the exact event bytes and accepts a successful response', async () => {
    const pair = generateKeyPairSync('ed25519')
    let captured: Parameters<WebhookPost>[0] | undefined
    const status = await deliverSignedWebhook({ rawUrl: 'https://receiver.example/hooks/bots', deliveryId: 'delivery-1', body: '{"hello":"world"}', privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() }, {
      resolve: resolver,
      now: 1_800_000_000_000,
      post: async input => { captured = input; return 204 },
    })
    expect(status).toBe(204)
    expect(captured?.addresses).toEqual(['93.184.216.34'])
    expect(captured?.headers['x-deepseek-delivery-id']).toBe('delivery-1')
    const signature = captured?.headers['x-deepseek-delivery-signature']
    const match = /^t=(\d+),ed25519=(.+)$/.exec(signature ?? '')
    expect(match?.[1]).toBe('1800000000')
    expect(verify(null, Buffer.from(`${match?.[1]}.${captured?.body}`), pair.publicKey, Buffer.from(match?.[2] ?? '', 'base64'))).toBe(true)
  })

  it('rejects private DNS answers, non-HTTPS, query credentials and nonstandard ports before delivery', async () => {
    await expect(validateWebhookTarget('https://receiver.example/hook', async () => ['93.184.216.34', '10.0.0.4'])).rejects.toThrow('blocked')
    await expect(validateWebhookTarget('http://receiver.example/hook', resolver)).rejects.toThrow('HTTPS')
    await expect(validateWebhookTarget('https://receiver.example/hook?token=secret', resolver)).rejects.toThrow('query')
    await expect(validateWebhookTarget('https://receiver.example:8443/hook', resolver)).rejects.toThrow('port 443')
  })

  it('keeps signing keys out of SQLite and retries transient delivery failures with a stable idempotency key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsk-delivery-')); directories.push(directory)
    const store = new BotStore({ path: join(directory, 'state.db') }); stores.push(store)
    const bot = store.createBot({ name: 'sender', projectRoot: directory, instructions: 'Notify the configured receiver after work.' })
    const target = await store.addDeliveryTarget(bot.id, 'https://receiver.example/hook', ['run.completed'], resolver)
    const run = store.enqueue(bot.id, 'Prepare the report'), claimedRun = store.claim(bot.id, 'worker')!
    store.finish(run.id, 'worker', 'completed', 'Report is ready. api_key=sk_live_not-for-delivery')
    store.acknowledgeStop(run.id, 'worker')

    const first = store.claimDelivery('delivery-worker')!
    expect(first.record.eventType).toBe('run.completed')
    expect(first.target.id).toBe(target.id)
    expect(JSON.parse(first.record.body).payload.output).not.toContain('sk_live_not-for-delivery')
    const key = await store.deliveryPrivateKey(target.id)
    expect((lstatSync(join(directory, 'actors', bot.id, 'deliveries', `${target.id}.key`)).mode & 0o077)).toBe(0)
    expect(store.store.query('SELECT * FROM bot_delivery_targets').map(row => JSON.stringify(row)).join('\n')).not.toContain(key)
    expect(claimedRun.id).toBe(run.id)

    const queued = store.completeDelivery(first.record.id, 'delivery-worker', { status: 503 })
    expect(queued).toMatchObject({ status: 'queued', attempt: 1 })
    const retry = store.claimDelivery('delivery-worker-2', queued.nextAt)!
    expect(retry.record.id).toBe(first.record.id)
    expect(retry.record.attempt).toBe(2)
    const delivered = store.completeDelivery(retry.record.id, 'delivery-worker-2', { status: 204 }, queued.nextAt)
    expect(delivered).toMatchObject({ status: 'delivered', attempt: 2, responseStatus: 204 })
    expect(store.deliveryHistory(bot.id)).toHaveLength(1)
    expect(await store.deleteDeliveryTarget(bot.id, target.id)).toBe(true)
    expect(store.deliveryTargets(bot.id)).toEqual([])
  })

  it('bounds delivery text in UTF-8 and preserves run completion when serialized output is too large', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsk-delivery-size-')); directories.push(directory)
    const store = new BotStore({ path: join(directory, 'state.db') }); stores.push(store)
    const bot = store.createBot({ name: 'sender', projectRoot: directory, instructions: 'Notify the configured receiver.' })
    await store.addDeliveryTarget(bot.id, 'https://receiver.example/hook', ['run.completed'], resolver)
    const bodyFor = (runId: string) => {
      const row = store.store.query('SELECT body FROM bot_delivery_outbox WHERE event_id=?', `run:${runId}:completed`)[0]
      return String(row?.body)
    }

    const unicodeRun = store.enqueue(bot.id, 'Prepare a large report')
    store.claim(bot.id, 'worker')!
    store.finish(unicodeRun.id, 'worker', 'completed', '🙂'.repeat(12_000), 'é'.repeat(4_000))
    const unicodeBody = bodyFor(unicodeRun.id), unicodePayload = JSON.parse(unicodeBody).payload
    expect(Buffer.byteLength(unicodeBody, 'utf8')).toBeLessThanOrEqual(24_576)
    expect(Buffer.byteLength(unicodePayload.output, 'utf8')).toBeLessThanOrEqual(12 * 1024)
    expect(unicodePayload.output.endsWith('…')).toBe(true)
    expect(Buffer.byteLength(unicodePayload.error, 'utf8')).toBeLessThanOrEqual(4 * 1024)
    expect(store.getRun(unicodeRun.id).status).toBe('completed')
    store.acknowledgeStop(unicodeRun.id, 'worker')

    const escapedRun = store.enqueue(bot.id, 'Prepare an escaped report')
    store.claim(bot.id, 'worker')!
    store.finish(escapedRun.id, 'worker', 'completed', '\n'.repeat(12_000), '\n'.repeat(4_000))
    const escapedBody = bodyFor(escapedRun.id), escapedPayload = JSON.parse(escapedBody).payload
    expect(Buffer.byteLength(escapedBody, 'utf8')).toBeLessThanOrEqual(24_576)
    expect(escapedPayload.output).toBe('[output omitted to fit delivery size limit]')
    expect(store.getRun(escapedRun.id).status).toBe('completed')
  })

  it('does not retry permanent receiver errors and fences an expired delivery owner', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsk-delivery-fence-')); directories.push(directory)
    const store = new BotStore({ path: join(directory, 'state.db') }); stores.push(store)
    const bot = store.createBot({ name: 'sender', projectRoot: directory, instructions: 'Notify the receiver.' })
    await store.addDeliveryTarget(bot.id, 'https://receiver.example/hook', ['run.failed'], resolver)
    const run = store.enqueue(bot.id, 'Fail safely'), claimedRun = store.claim(bot.id, 'worker')!
    store.finish(run.id, 'worker', 'failed', '', 'Provider unavailable')
    store.acknowledgeStop(run.id, 'worker')
    const first = store.claimDelivery('old-owner')!
    const expiredAt = (first.record.leaseUntil ?? 0) + 1
    const second = store.claimDelivery('new-owner', expiredAt)!
    expect(second.record.id).toBe(first.record.id)
    expect(() => store.completeDelivery(first.record.id, 'old-owner', { status: 204 }, expiredAt)).toThrow('ownership')
    const terminal = store.completeDelivery(second.record.id, 'new-owner', { status: 400 }, expiredAt)
    expect(terminal.status).toBe('failed')
    expect(store.claimDelivery('new-owner', terminal.nextAt + 60_000)).toBeNull()
    expect(store.retryDelivery(bot.id, terminal.id)).toMatchObject({ status: 'queued', attempt: 0 })
    expect(claimedRun.id).toBe(run.id)
  })
})
