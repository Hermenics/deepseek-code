import { Tool } from './types.js'

const TIMEOUT_MS = 15_000
const MAX_CHARS = 20_000

function isValidUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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
      return `[Erro] URL inválida: "${url}". A URL deve começar com http:// ou https://`
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })

      if (!res.ok) {
        return `[Erro] HTTP ${res.status}: falha ao acessar ${url}`
      }

      const text = await res.text()
      const clean = stripHtml(text)
      return clean.slice(0, MAX_CHARS)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return `[Erro] Timeout: a requisição para ${url} excedeu ${TIMEOUT_MS / 1000}s`
      }
      if (err instanceof TypeError) {
        // fetch throws TypeError for network failures (DNS, connection refused, etc.)
        return `[Erro] Falha de rede ao acessar ${url}: ${err.message}`
      }
      const message = err instanceof Error ? err.message : String(err)
      return `[Erro] Falha ao buscar ${url}: ${message}`
    }
  },
}
