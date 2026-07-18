import { lookup } from 'dns/promises'
import { isIP } from 'node:net'
import { Tool } from '../types.js'

const TIMEOUT_MS = 15_000
const MAX_CHARS = 20_000
const MAX_REDIRECTS = 5

function isValidUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    // Block localhost
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    // Block AWS/GCP/Azure metadata
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return true
    // Block private networks
    if (host.startsWith('10.')) return true
    if (host.startsWith('192.168.')) return true
    if (host.startsWith('172.')) {
      const second = parseInt(host.split('.')[1] || '0', 10)
      if (second >= 16 && second <= 31) return true
    }
    // Block link-local
    if (host.startsWith('169.254.')) return true
    return false
  } catch {
    return true
  }
}

function isPrivateIp(ip: string): boolean {
  // IPv4 checks
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return true
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('169.254.')) return true
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] || '0', 10)
    if (second >= 16 && second <= 31) return true
  }

  // IPv6 checks
  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  // IPv6-mapped IPv4: ::ffff:x.x.x.x
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7) // strip "::ffff:"
    return isPrivateIp(mapped)
  }
  // Link-local fe80::/10
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
  // Unique local fc00::/7 (fc00:: and fd00::)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true

  return false
}

const DNS_TIMEOUT_MS = 2000

interface ResolvedTarget { address: string; family: 4 | 6 }

async function resolvePublicTarget(url: string): Promise<ResolvedTarget | null> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')

    // If the hostname is already an IP literal, check directly
    const family = isIP(hostname)
    if (family) return isPrivateIp(hostname) ? null : { address: hostname, family: family as 4 | 6 }

    let timer: ReturnType<typeof setTimeout> | undefined
    const results = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS) }),
    ]).finally(() => clearTimeout(timer))

    // Block if ANY resolved address is private
    if (!results.length || results.some(result => isPrivateIp(result.address))) return null
    return { address: results[0]!.address, family: results[0]!.family as 4 | 6 }
  } catch {
    // Fail-closed: if DNS resolution fails, block the request
    return null
  }
}

function stripHtml(html: string): string {
  return html
    // Remove scripts e styles completos (conteúdo + tag)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    // Remove todas as outras tags
    .replace(/<[^>]+>/g, ' ')
    // Decodifica entidades HTML comuns
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Colapsa espaços em branco excessivos
    .replace(/\s+/g, ' ')
    .trim()
}

export const WebFetch: Tool = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the page text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
    },
    required: ['url'],
  },
  async execute(args, context) {
    const requestedUrl = args.url as string

    if (!isValidUrl(requestedUrl)) {
      return `Error: invalid URL "${requestedUrl}". Must start with http:// or https://`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), TIMEOUT_MS)
    const cancel = () => controller.abort(context?.signal?.reason)
    if (context?.signal?.aborted) cancel()
    else context?.signal?.addEventListener('abort', cancel, { once: true })
    try {
      let url = requestedUrl
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
        if (isBlockedUrl(url)) return 'Error: URL points to a private/internal network address which is blocked for security reasons.'
        const resolved = await resolvePublicTarget(url)
        if (!resolved) return 'Error: URL resolves to a private/internal network address which is blocked for security reasons.'
        if (controller.signal.aborted) throw controller.signal.reason
        const original = new URL(url)
        const pinned = new URL(url)
        pinned.hostname = resolved.family === 6 ? `[${resolved.address}]` : resolved.address
        const res = await fetch(pinned, {
          signal: controller.signal,
          redirect: 'manual',
          keepalive: false,
          headers: { host: original.host },
          ...(original.protocol === 'https:' ? { tls: { serverName: original.hostname } } : {}),
        })
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location')
          if (!location) return `Error: redirect without Location fetching ${url}`
          if (redirect === MAX_REDIRECTS) return `Error: too many redirects fetching ${requestedUrl}`
          url = new URL(location, url).toString()
          if (!isValidUrl(url)) return 'Error: redirect uses a blocked URL protocol.'
          continue
        }

        if (!res.ok) return `Error: HTTP ${res.status} fetching ${url}`

        const text = await res.text()
        const clean = stripHtml(text)
        return clean.slice(0, MAX_CHARS)
      }
      return `Error: too many redirects fetching ${requestedUrl}`
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return `Error: timeout fetching ${requestedUrl} (limit: ${TIMEOUT_MS / 1000}s)`
      }
      if (err instanceof TypeError) {
        // fetch throws TypeError for network failures (DNS, connection refused, etc.)
        return `Error: network failure fetching ${requestedUrl}: ${err.message}`
      }
      const message = err instanceof Error ? err.message : String(err)
      return `Error: failed to fetch ${requestedUrl}: ${message}`
    } finally {
      clearTimeout(timeout)
      context?.signal?.removeEventListener('abort', cancel)
    }
  },
}
