import { lookup } from 'dns/promises'
import { BlockList, isIP } from 'node:net'
import { Tool } from '../types.js'

const TIMEOUT_MS = 15_000
const MAX_CHARS = 20_000
const MAX_BODY_BYTES = MAX_CHARS * 4
const MAX_REDIRECTS = 5
const DNS_TIMEOUT_MS = 2000

type IpFamily = 'ipv4' | 'ipv6'
type Subnet = readonly [address: string, prefix: number]

// IANA special-purpose ranges: only globally routable addresses may be fetched.
const BLOCKED_IPV4_SUBNETS: readonly Subnet[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const BLOCKED_IPV6_SUBNETS: readonly Subnet[] = [
  ['::', 96],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]

function createBlockList(subnets: readonly Subnet[], family: IpFamily): BlockList {
  const blockList = new BlockList()
  for (const [address, prefix] of subnets) blockList.addSubnet(address, prefix, family)
  return blockList
}

const blockedIpv4 = createBlockList(BLOCKED_IPV4_SUBNETS, 'ipv4')
const blockedIpv6 = createBlockList(BLOCKED_IPV6_SUBNETS, 'ipv6')

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return blockedIpv4.check(ip, 'ipv4')
  // Bun on Windows 1.3.x can crash inside BlockList.check for the canonical
  // hexadecimal form of IPv4-mapped IPv6 addresses. They are intentionally
  // blocked as a whole range, so avoid the native call without weakening the
  // SSRF policy.
  if (family === 6 && /^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(ip)) return true
  if (family === 6) return blockedIpv6.check(ip, 'ipv6')
  return true
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

function isValidUrl(url: string): boolean {
  return parseHttpUrl(url) !== null
}

function isBlockedUrl(url: string): boolean {
  const parsed = parseHttpUrl(url)
  if (!parsed) return true
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const family = isIP(host)
  return host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal' || (family !== 0 && isBlockedIp(host))
}

interface ResolvedTarget { address: string; family: 4 | 6 }

async function resolvePublicTarget(url: string): Promise<ResolvedTarget | null> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')

    // If the hostname is already an IP literal, check directly
    const family = isIP(hostname)
    if (family) return isBlockedIp(hostname) ? null : { address: hostname, family: family as 4 | 6 }

    let timer: ReturnType<typeof setTimeout> | undefined
    const results = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS) }),
    ]).finally(() => clearTimeout(timer))

    // Block if ANY resolved address is private
    if (!results.length || results.some(result => isBlockedIp(result.address))) return null
    return { address: results[0]!.address, family: results[0]!.family as 4 | 6 }
  } catch {
    // Fail-closed: if DNS resolution fails, block the request
    return null
  }
}

class ResponseTooLargeError extends Error {
  constructor() {
    super(`response body exceeds ${MAX_BODY_BYTES} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

async function readBodyWithinLimit(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    const cancel = response.body && typeof response.body.cancel === 'function' ? response.body.cancel.bind(response.body) : null
    await cancel?.()
    throw new ResponseTooLargeError()
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()

      const remaining = MAX_BODY_BYTES - bytesRead
      if (value.byteLength > remaining) {
        if (remaining > 0) text += decoder.decode(value.subarray(0, remaining), { stream: true })
        await reader.cancel()
        throw new ResponseTooLargeError()
      }

      bytesRead += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function stripHtml(html: string): string {
  return html
    // Remove scripts e styles completos (conteúdo + tag).
    // The closing-tag regex accepts attributes (`</script foo="bar">`) because
    // browsers tolerate that parser error and would execute the script body.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ')
    // Remove todas as outras tags
    .replace(/<[^>]+>/g, ' ')
    // Decodifica entidades HTML comuns. The ampersand is decoded LAST so an
    // entity like &amp;lt; (which means a literal "&lt;", not "<") does not get
    // double-unescaped into "<" (CodeQL js/double-escaping).
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
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

        const text = await readBodyWithinLimit(res)
        const clean = stripHtml(text)
        return Array.from(clean).slice(0, MAX_CHARS).join('')
      }
      return `Error: too many redirects fetching ${requestedUrl}`
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return `Error: timeout fetching ${requestedUrl} (limit: ${TIMEOUT_MS / 1000}s)`
      }
      if (err instanceof ResponseTooLargeError) return `Error: ${err.message}`
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
