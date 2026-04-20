import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'

describe('WebFetch tool', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('chama fetch com a URL passada', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const fetchMock = mock(() =>
      Promise.resolve({ text: () => Promise.resolve('conteúdo simples') } as Response)
    )
    global.fetch = fetchMock as any
    await WebFetch.execute({ url: 'https://example.com' })
    expect(fetchMock).toHaveBeenCalledWith('https://example.com')
  })

  it('remove tags HTML do conteúdo', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ text: () => Promise.resolve('<p>texto limpo</p><b>negrito</b>') } as Response)
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
    global.fetch = mock(() =>
      Promise.resolve({ text: () => Promise.resolve(longContent) } as Response)
    ) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect((result as string).length).toBeLessThanOrEqual(20000)
  })

  it('conteúdo menor que 20.000 chars não é truncado', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    const shortContent = 'conteúdo curto'
    global.fetch = mock(() =>
      Promise.resolve({ text: () => Promise.resolve(shortContent) } as Response)
    ) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(result).toContain('conteúdo curto')
  })

  it('retorna string para resposta válida', async () => {
    const { WebFetch } = await import('../src/tools/WebFetch.js')
    global.fetch = mock(() =>
      Promise.resolve({ text: () => Promise.resolve('ok') } as Response)
    ) as any
    const result = await WebFetch.execute({ url: 'https://example.com' })
    expect(typeof result).toBe('string')
  })
})
