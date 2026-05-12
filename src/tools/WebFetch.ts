import { Tool } from './types.js'

const TIMEOUT_MS = 15_000
const MAX_CHARS = 20_000

function isValidUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
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
