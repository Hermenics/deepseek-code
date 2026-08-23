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

  // --- Happy path (testes originais adaptados) ---

  it('chama fetch com a URL e signal de timeout', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(okResponse('conteúdo simples')))
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

  it('remove tags HTML do conteúdo', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve(okResponse('<p>texto limpo</p><b>negrito</b>'))
    ) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<b>')
    expect(result).toContain('texto limpo')
    expect(result).toContain('negrito')
  })

  it('remove script com tag de fechamento malformada (CodeQL js/bad-tag-filter)', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve(okResponse('ok <script>alert(1)</script foo="bar"> resto'))
    ) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).not.toContain('alert(1)')
    expect(result).not.toContain('<script')
    expect(result).toContain('ok')
    expect(result).toContain('resto')
  })

  it('trunca conteúdo em 20.000 chars', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const longContent = 'a'.repeat(30000)
    global.fetch = mock(() => Promise.resolve(okResponse(longContent))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect((result as string).length).toBeLessThanOrEqual(20000)
  })

  it('mantém UTF-8 válido e limita caracteres sem cortar emoji', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const content = '🙂'.repeat(20000)
    global.fetch = mock(() => Promise.resolve(okResponse(content))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toBe(content)
    expect((result as string).includes('\uFFFD')).toBe(false)
  })

  it('rejeita Content-Length acima do limite antes de ler o body', async () => {
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

  it('cancela resposta chunked ao atingir o limite de bytes', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    let cancelled = false
    global.fetch = mock(() => Promise.resolve(streamResponse(['a'.repeat(10000), 'b'.repeat(80000), 'c'], {
      onCancel: () => { cancelled = true },
    }))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('response body exceeds')
    expect(cancelled).toBe(true)
  })

  it('conteúdo menor que 20.000 chars não é truncado', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const shortContent = 'conteúdo curto'
    global.fetch = mock(() => Promise.resolve(okResponse(shortContent))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('conteúdo curto')
  })

  it('retorna string para resposta válida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('ok'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(typeof result).toBe('string')
  })

  // --- Validação de URL ---

  it('rejeita URL sem protocolo http/https', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const result = await WebFetch.execute({ url: 'ftp://example.com' })
    expect(result).toContain('Error:')
    expect(result).toContain('invalid URL')
  })

  it('rejeita URL completamente inválida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const result = await WebFetch.execute({ url: 'não-é-url' })
    expect(result).toContain('Error:')
    expect(result).toContain('invalid URL')
  })

  it('aceita URL com http://', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('ok'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTP_URL })
    expect(result).not.toContain('Error:')
  })

  it.each([
    ['loopback IPv4', 'http://127.0.0.2/'],
    ['loopback IPv6', 'http://[::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.2]/'],
  ])('bloqueia %s', async (_, url) => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(okResponse('must not fetch')))
    global.fetch = fetchMock as any
    const result = await WebFetch.execute({ url })
    expect(result).toContain('private/internal network')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revalida cada redirect e bloqueia destino interno', async () => {
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

  // --- Status HTTP não-2xx ---

  it('retorna erro para status 404', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: `${PUBLIC_HTTPS_URL}/nope` })
    expect(result).toContain('Error:')
    expect(result).toContain('404')
  })

  it('retorna erro para status 500', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: `${PUBLIC_HTTPS_URL}/error` })
    expect(result).toContain('Error:')
    expect(result).toContain('500')
  })

  // --- Erros de rede ---

  it('retorna erro amigável para falha de rede', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.reject(new TypeError('fetch failed'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('Error:')
    expect(result).toContain('network failure')
  })

  // --- Timeout ---

  it('retorna erro amigável para timeout', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    const timeoutErr = new DOMException('The operation was aborted.', 'TimeoutError')
    global.fetch = mock(() => Promise.reject(timeoutErr)) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('Error:')
    expect(result).toContain('timeout')
    expect(result).toContain('15s')
  })

  // --- Erro genérico ---

  it('retorna erro amigável para exceção desconhecida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch/WebFetch.js')
    global.fetch = mock(() => Promise.reject(new Error('algo inesperado'))) as any
    const result = await WebFetch.execute({ url: PUBLIC_HTTPS_URL })
    expect(result).toContain('Error:')
    expect(result).toContain('algo inesperado')
  })
})
