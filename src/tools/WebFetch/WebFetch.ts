import { lookup } from 'dns/promises'
import { Tool } from '../types.js'

const TIMEOUT_MS = 15_000
const MAX_CHARS = 20_000

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

async function isBlockedResolvedIp(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname

    // If the hostname is already an IP literal, check directly
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
      return isPrivateIp(hostname)
    }

    const results = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS)
      ),
    ])

    // Block if ANY resolved address is private
    for (const result of results) {
      if (isPrivateIp(result.address)) return true
    }

    return false
  } catch {
    // Fail-closed: if DNS resolution fails, block the request
    return true
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
  async execute(args) {
    const url = args.url as string

    if (!isValidUrl(url)) {
      return `Error: invalid URL "${url}". Must start with http:// or https://`
    }

    if (isBlockedUrl(url)) {
      return 'Error: URL points to a private/internal network address which is blocked for security reasons.'
    }

    if (await isBlockedResolvedIp(url)) {
      return 'Error: URL resolves to a private/internal network address which is blocked for security reasons.'
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })

      if (!res.ok) {
        return `Error: HTTP ${res.status} fetching ${url}`
      }

      const text = await res.text()
      const clean = stripHtml(text)
      return clean.slice(0, MAX_CHARS)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return `Error: timeout fetching ${url} (limit: ${TIMEOUT_MS / 1000}s)`
      }
      if (err instanceof TypeError) {
        // fetch throws TypeError for network failures (DNS, connection refused, etc.)
        return `Error: network failure fetching ${url}: ${err.message}`
      }
      const message = err instanceof Error ? err.message : String(err)
      return `Error: failed to fetch ${url}: ${message}`
    }
  },
}
