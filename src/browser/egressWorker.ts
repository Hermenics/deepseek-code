import { createSecureContext } from 'node:tls'
import { EgressEngine } from './egressEngine.js'
import { systemResolver } from './policy.js'

let gate: EgressEngine | undefined, initialized = false, sequence = 0
const pending = new Map<number, { done(value: unknown): void; fail(): void }>()
function query(type: string, params: Record<string, unknown>): Promise<unknown> {
  if (!process.connected || pending.size >= 512) return Promise.reject(Error('Network owner unavailable'))
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Network owner timed out')) }, 5000)
    pending.set(id, { done(value) { clearTimeout(timer); resolve(value) }, fail() { clearTimeout(timer); reject(Error('Network owner disconnected')) } })
    process.send!({ type, id, ...params })
  })
}
function close(): void { gate?.stop(); for (const waiter of pending.values()) waiter.fail(); pending.clear(); process.exit(0) }
process.on('disconnect', close)
process.on('SIGTERM', close)
process.on('SIGINT', close)
process.on('message', message => {
  const value = message as { type?: string; id?: number; value?: unknown; key?: string; cert?: string; spki?: string; certificateAuthority?: string; customResolver?: boolean }
  if (value.type === 'reply' && typeof value.id === 'number') { const waiter = pending.get(value.id); pending.delete(value.id); waiter?.done(value.value); return }
  if (value.type !== 'init' || initialized) return
  initialized = true
  void (async () => {
    if (!value.key || !value.cert || !value.spki) throw new Error('Missing private network identity')
    const certificate = { key: value.key, cert: value.cert, spki: value.spki, context: createSecureContext({ key: value.key, cert: value.cert }) }
    gate = await EgressEngine.start(certificate, async (url, origin) => await query('authorize', { url, origin }) === true,
      value.customResolver ? async host => { const result = await query('resolve', { host }); if (!Array.isArray(result) || !result.every(value => typeof value === 'string')) throw new Error('Invalid resolver result'); return result as string[] } : systemResolver,
      value.certificateAuthority)
    process.send!({ type: 'ready', url: gate.url, username: gate.username, password: gate.password, realm: gate.realm, cleanupDirectory: gate.cleanupDirectory })
  })().catch(() => { process.send?.({ type: 'error' }); gate?.stop(); process.exit(1) })
})
