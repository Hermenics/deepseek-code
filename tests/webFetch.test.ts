import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'

describe('WebFetch tool', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  /** Helper: cria um Response mock com ok=true e status=200 */
  function okResponse(body: string): Response {
    return { ok: true, status: 200, text: () => Promise.resolve(body) } as Response
  }

  // --- Happy path (testes originais adaptados) ---

  it('chama fetch com a URL e signal de timeout', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const fetchMock = mock(() => Promise.resolve(okResponse('conteúdo simples')))
    global.fetch = fetchMock as any
    await WebFetch.execute({ url: 'https://example.com' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe('https://example.com')
    expect(call[1]).toHaveProperty('signal')
  })

  it('remove tags HTML do conteúdo', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve(okResponse('<p>texto limpo</p><b>negrito</b>'))
    ) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<b>')
    expect(result).toContain('texto limpo')
    expect(result).toContain('negrito')
  })

  it('trunca conteúdo em 20.000 chars', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const longContent = 'a'.repeat(30000)
    global.fetch = mock(() => Promise.resolve(okResponse(longContent))) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect((result as string).length).toBeLessThanOrEqual(20000)
  })

  it('conteúdo menor que 20.000 chars não é truncado', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const shortContent = 'conteúdo curto'
    global.fetch = mock(() => Promise.resolve(okResponse(shortContent))) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(result).toContain('conteúdo curto')
  })

  it('retorna string para resposta válida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('ok'))) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(typeof result).toBe('string')
  })

  // --- Validação de URL ---

  it('rejeita URL sem protocolo http/https', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const result = await WebFetch.execute({ url: 'ftp://example.com' })
    expect(result).toContain('Error:')
    expect(result).toContain('invalid URL')
  })

  it('rejeita URL completamente inválida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const result = await WebFetch.execute({ url: 'não-é-url' })
    expect(result).toContain('Error:')
    expect(result).toContain('invalid URL')
  })

  it('aceita URL com http://', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() => Promise.resolve(okResponse('ok'))) as any
    const result = await WebFetch.execute({ url: 'http://example.com' })
    expect(result).not.toContain('Error:')
  })

  // --- Status HTTP não-2xx ---

  it('retorna erro para status 404', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: 'https://example.com/nope' })
    expect(result).toContain('Error:')
    expect(result).toContain('404')
  })

  it('retorna erro para status 500', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: 'https://example.com/error' })
    expect(result).toContain('Error:')
    expect(result).toContain('500')
  })

  // --- Erros de rede ---

  it('retorna erro amigável para falha de rede', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() => Promise.reject(new TypeError('fetch failed'))) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(result).toContain('Error:')
    expect(result).toContain('network failure')
  })

  // --- Timeout ---

  it('retorna erro amigável para timeout', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const timeoutErr = new DOMException('The operation was aborted.', 'TimeoutError')
    global.fetch = mock(() => Promise.reject(timeoutErr)) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(result).toContain('Error:')
    expect(result).toContain('timeout')
    expect(result).toContain('15s')
  })

  // --- Erro genérico ---

  it('retorna erro amigável para exceção desconhecida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() => Promise.reject(new Error('algo inesperado'))) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(result).toContain('Error:')
    expect(result).toContain('algo inesperado')
  })
})
