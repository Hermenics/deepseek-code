import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'

const lookupMock = mock(async () => [{ address: '93.184.216.34', family: 4 }])
mock.module('dns/promises', () => ({ lookup: lookupMock }))

describe('WebFetch tool', () => {
  let originalFetch: typeof global.fetch
  const PUBLIC_HTTP_URL = 'http://93.184.216.34'
  const PUBLIC_HTTPS_URL = 'https://93.184.216.34'

  beforeEach(() => {
    originalFetch = global.fetch
    lookupMock.mockClear()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  function streamResponse(
    chunks: string[],
    options: { status?: number; headers?: HeadersInit; onCancel?: () => void } = {},
  ): Response {
    let index = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === chunks.length) controller.close()
        else controller.enqueue(new TextEncoder().encode(chunks[index++]!))
      },
      cancel() {
        options.onCancel?.()
      },
    })
    const status = options.status ?? 200
    return { ok: status >= 200 && status < 300, status, headers: new Headers(options.headers), body } as Response
  }

  function okResponse(body: string, headers?: HeadersInit): Response {
    return streamResponse([body], { headers })
  }

  // --- Happy path (adapted from the original tests) ---

  it('calls fetch with the URL and timeout signal', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(okResponse('simple content')))
    global.fetch = fetchMock as any
    await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(call[0].toString()).toBe(`${PUBLIC_HTTPS_URL}/`)
    expect(call[1]).toHaveProperty('signal')
  })

  it('pins hostname requests to the validated address', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(okResponse('safe')))
    global.fetch = fetchMock as any
    await WebFetch.execute({ url: 'https://safe.example/path' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit & { tls: { serverName: string } }]
    expect(url.toString()).toBe('https://93.184.216.34/path')
    expect(init.headers).toEqual({ host: 'safe.example' })
    expect(init.tls.serverName).toBe('safe.example')
    expect(lookupMock).toHaveBeenCalledTimes(1)
  })

  it('removes HTML tags from content', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve(okResponse('<p>clean text</p><b>bold</b>'))
    ) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<b>')
    expect(result).toContain('clean text')
    expect(result).toContain('bold')
  })

  it('removes a script with a malformed closing tag (CodeQL js/bad-tag-filter)', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve(okResponse('ok <script>alert(1)</script foo="bar"> rest'))
    ) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).not.toContain('alert(1)')
    expect(result).not.toContain('<script')
    expect(result).toContain('ok')
    expect(result).toContain('rest')
  })

  it('strips markup revealed by one layer of HTML entity decoding', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('safe &lt;script&gt;alert(1)&lt;/script&gt; &#60;style&#62;hidden&#60;/style&#62; &amp;lt;b&amp;gt;'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).not.toContain('alert(1)')
    expect(result).not.toContain('hidden')
    expect(result).toContain('safe')
    expect(result).toContain('&lt;b&gt;')
  })

  it('truncates content at 20,000 characters', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const longContent = 'a'.repeat(30000)
    global.fetch = mock(() => Promise.resolve(okResponse(longContent))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect((result as string).length).toBeLessThanOrEqual(20000)
  })

  it('keeps valid UTF-8 and limits characters without cutting emojis', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const content = '🙂'.repeat(20000)
    global.fetch = mock(() => Promise.resolve(okResponse(content))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toBe(content)
    expect((result as string).includes('\uFFFD')).toBe(false)
  })

  it('rejects Content-Length above the limit before reading the body', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    let read = false
    let cancelled = false
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(20000 * 4 + 1) }),
      body: { cancel: () => { cancelled = true }, getReader: () => { read = true; throw new Error('body should not be read') } },
    } as unknown as Response
    global.fetch = mock(() => Promise.resolve(response)) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('response body exceeds')
    expect(read).toBe(false)
    expect(cancelled).toBe(true)
  })

  it('cancels a chunked response when it reaches the byte limit', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    let cancelled = false
    global.fetch = mock(() => Promise.resolve(streamResponse(['a'.repeat(10000), 'b'.repeat(80000), 'c'], {
      onCancel: () => { cancelled = true },
    }))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('response body exceeds')
    expect(cancelled).toBe(true)
  })

  it('does not truncate content shorter than 20,000 characters', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const shortContent = 'short content'
    global.fetch = mock(() => Promise.resolve(okResponse(shortContent))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('short content')
  })

  it('returns a string for a valid response', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('ok'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(typeof result).toBe('string')
  })

  // --- URL validation ---

  it('rejects a URL without the http/https protocol', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const result = await WebFetch.execute({ url: 'ftp://example.com' })
    expect(result).toContain('Error:')
    expect(result).toContain('invalid URL')
  })

  it('rejects a completely invalid URL', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const result = await WebFetch.execute({ url: 'not-a-url' })
    expect(result).toContain('Error:')
    expect(result).toContain('invalid URL')
  })

  it('accepts a URL with http://', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('ok'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTP_URL })
    expect(result).not.toContain('Error:')
  })

  it.each([
    ['loopback IPv4', 'http://127.0.0.2/'],
    ['loopback IPv6', 'http://[::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.2]/'],
  ])('blocks %s', async (_, url) => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(okResponse('must not fetch')))
    global.fetch = fetchMock as any
    const result = await WebFetch.execute({ url })
    expect(result).toContain('private/internal network')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revalidates each redirect and blocks internal destinations', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(streamResponse([], {
      status: 302,
      headers: { location: 'http://127.0.0.2/' },
    })))
    global.fetch = fetchMock as any
    const result = await WebFetch.execute({ url: 'https://safe.example/redirect' })
    expect(result).toContain('private/internal network')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // --- Non-2xx HTTP status ---

  it('returns an error for status 404', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: `${PUBLIC_HTTPS_URL}/nope` })
    expect(result).toContain('Error:')
    expect(result).toContain('404')
  })

  it('returns an error for status 500', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: `${PUBLIC_HTTPS_URL}/error` })
    expect(result).toContain('Error:')
    expect(result).toContain('500')
  })

  // --- Network errors ---

  it('returns a friendly error for a network failure', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.reject(new TypeError('fetch failed'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('Error:')
    expect(result).toContain('network failure')
  })

  // --- Timeout ---

  it('returns a friendly error for a timeout', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const timeoutErr = new DOMException('The operation was aborted.', 'TimeoutError')
    global.fetch = mock(() => Promise.reject(timeoutErr)) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('Error:')
    expect(result).toContain('timeout')
    expect(result).toContain('15s')
  })

  // --- Generic error ---

  it('returns a friendly error for an unknown exception', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.reject(new Error('something unexpected'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('Error:')
    expect(result).toContain('something unexpected')
  })
})
