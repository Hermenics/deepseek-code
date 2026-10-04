import { lookup } from 'dns/promises'
import { isIP } from 'node:net'
import { isBlockedIp } from '../tools/WebFetch/WebFetch.js'

/**
 * Where a URL may take the browser:
 * - `loopback`: this machine (localhost, 127.0.0.0/8, ::1) — the dev-server case;
 * - `public`: every address the host resolves to is globally routable;
 * - `blocked`: anything else (private LAN, link-local/cloud metadata, 0.0.0.0, odd schemes, credentials in the URL).
 */
export type TargetClass = 'loopback' | 'public' | 'blocked'

export interface Classification {
  kind: TargetClass
  /** Normalized origin (`http://localhost:3000`); undefined when blocked before parsing. */
  origin?: string
  reason?: string
}

export type Resolver = (hostname: string) => Promise<string[]>

const DNS_TIMEOUT_MS = 2000
const MAX_URL_LENGTH = 2048

/** Resolves every address of `hostname` with a 2s timeout. */
export const systemResolver: Resolver = async hostname => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const results = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS) }),
    ])
    return results.map(result => result.address)
  } finally {
    clearTimeout(timer)
  }
}

/** Host without brackets or a trailing dot, lowercase (`[::1]` → `::1`, `localhost.` → `localhost`). */
function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

/** True for localhost names and loopback IP literals. */
export function isLoopbackHost(hostname: string): boolean {
  const host = bareHost(hostname)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (isIP(host) === 4) return host.startsWith('127.')
  return host === '::1'
}

/**
 * Classifies a navigation target. Only http(s) and about:blank are ever allowed; the URL parser
 * already canonicalizes numeric hosts (`http://2130706433/` is 127.0.0.1). Public hostnames must
 * resolve exclusively to routable addresses, and DNS failure blocks (fail closed).
 */
export async function classifyUrl(raw: string, resolve: Resolver = systemResolver): Promise<Classification> {
  if (raw === 'about:blank') return { kind: 'loopback', origin: 'about:blank' }
  if (raw.length > MAX_URL_LENGTH) return { kind: 'blocked', reason: `URL longer than ${MAX_URL_LENGTH} characters` }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: 'blocked', reason: 'not a valid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'blocked', reason: `${url.protocol} URLs are not allowed; use http or https` }
  if (url.username || url.password) return { kind: 'blocked', reason: 'URLs with embedded credentials are not allowed' }
  const origin = url.origin
  const host = bareHost(url.hostname)
  if (isLoopbackHost(host)) return { kind: 'loopback', origin }
  if (host === 'metadata.google.internal') return { kind: 'blocked', origin, reason: 'cloud metadata endpoints are blocked' }
  if (isIP(host)) return isBlockedIp(host) ? { kind: 'blocked', origin, reason: `${host} is not a public address` } : { kind: 'public', origin }
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    return { kind: 'blocked', origin, reason: `could not resolve ${host}` }
  }
  if (addresses.length === 0) return { kind: 'blocked', origin, reason: `could not resolve ${host}` }
  const internal = addresses.find(address => isBlockedIp(address))
  return internal
    ? { kind: 'blocked', origin, reason: `${host} resolves to non-public address ${internal}` }
    : { kind: 'public', origin }
}

/** `classifyUrl` memoized per hostname for `ttlMs`, for the per-request checks on public pages. */
export function cachedClassifier(resolve: Resolver = systemResolver, ttlMs = 60_000): (raw: string) => Promise<Classification> {
  const addresses = new Map<string, { at: number; value: Promise<string[]> }>()
  const cachedResolve: Resolver = hostname => {
    const hit = addresses.get(hostname)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value
    const value = resolve(hostname)
    addresses.set(hostname, { at: Date.now(), value })
    value.catch(() => addresses.delete(hostname))
    return value
  }
  // This cache is only policy metadata. BrowserEgress independently resolves,
  // validates and pins each outbound socket; a cached result is not that boundary.
  return raw => classifyUrl(raw, cachedResolve)
}
