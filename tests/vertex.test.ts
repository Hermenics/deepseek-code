import { describe, it, expect, beforeEach, mock } from 'bun:test'

// Mock google-auth-library before importing the module under test
const mockGetAccessToken = mock(() =>
  Promise.resolve({ token: 'fake-oauth-token-123' }),
)

// Track constructor calls manually since Bun mock() doesn't handle `new` well
const constructorCalls: any[] = []

class MockGoogleAuth {
  constructor(opts: any) {
    constructorCalls.push(opts)
  }
  async getClient() {
    return { getAccessToken: mockGetAccessToken }
  }
}

mock.module('google-auth-library', () => ({
  GoogleAuth: MockGoogleAuth,
}))

// Import AFTER mocking
const {
  getVertexAccessToken,
  createVertexFetch,
  clearTokenCache,
} = await import('../src/agent/providers/vertex.js')

describe('vertex provider', () => {
  beforeEach(() => {
    clearTokenCache()
    mockGetAccessToken.mockClear()
    constructorCalls.length = 0
    // Reset to default return value
    mockGetAccessToken.mockImplementation(() =>
      Promise.resolve({ token: 'fake-oauth-token-123' }),
    )
  })

  describe('getVertexAccessToken', () => {
    it('chama GoogleAuth com keyFile e scopes corretos', async () => {
      await getVertexAccessToken('/path/to/sa.json')

      expect(constructorCalls).toHaveLength(1)
      expect(constructorCalls[0]).toEqual({
        keyFile: '/path/to/sa.json',
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      })
    })

    it('retorna o access token gerado', async () => {
      const token = await getVertexAccessToken('/path/to/sa.json')
      expect(token).toBe('fake-oauth-token-123')
    })

    it('retorna token do cache se ainda válido', async () => {
      // Primeira chamada — gera token
      await getVertexAccessToken('/path/to/sa.json')
      // Segunda chamada — deve usar cache
      await getVertexAccessToken('/path/to/sa.json')

      // GoogleAuth constructor deve ter sido chamado apenas 1 vez
      expect(mockGetAccessToken).toHaveBeenCalledTimes(1)
    })

    it('gera novo token se cache expirado', async () => {
      // Primeira chamada
      await getVertexAccessToken('/path/to/sa.json')

      // Simula expiração do cache manipulando o tempo
      // Avança o relógio 1 hora (token expira em 3600s, buffer de 5min)
      const originalNow = Date.now
      Date.now = () => originalNow() + 3600 * 1000

      try {
        await getVertexAccessToken('/path/to/sa.json')
        expect(mockGetAccessToken).toHaveBeenCalledTimes(2)
      } finally {
        Date.now = originalNow
      }
    })

    it('gera novo token quando falta menos de 5 minutos para expirar', async () => {
      await getVertexAccessToken('/path/to/sa.json')

      // Avança 56 minutos (3360s) — faltam 4min, dentro do buffer de 5min
      const originalNow = Date.now
      Date.now = () => originalNow() + 3360 * 1000

      try {
        await getVertexAccessToken('/path/to/sa.json')
        expect(mockGetAccessToken).toHaveBeenCalledTimes(2)
      } finally {
        Date.now = originalNow
      }
    })

    it('lança erro se getAccessToken retorna token nulo', async () => {
      mockGetAccessToken.mockImplementation(() =>
        Promise.resolve({ token: null }),
      )

      expect(getVertexAccessToken('/path/to/sa.json')).rejects.toThrow(
        'Falha ao obter access token do Vertex AI',
      )
    })
  })

  describe('clearTokenCache', () => {
    it('limpa o cache forçando nova geração de token', async () => {
      await getVertexAccessToken('/path/to/sa.json')
      clearTokenCache()
      await getVertexAccessToken('/path/to/sa.json')

      expect(mockGetAccessToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('createVertexFetch', () => {
    it('retorna uma função', () => {
      const fetchFn = createVertexFetch('/path/to/sa.json')
      expect(typeof fetchFn).toBe('function')
    })

    it('seta Authorization header com Bearer token real', async () => {
      const originalFetch = globalThis.fetch
      let capturedHeaders: Headers | null = null

      globalThis.fetch = mock(async (input: any, init?: any) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response('ok')
      }) as any

      try {
        const fetchFn = createVertexFetch('/path/to/sa.json')
        await fetchFn('https://vertex.googleapis.com/v1/test', {
          headers: { 'Content-Type': 'application/json' },
        })

        expect(capturedHeaders).not.toBeNull()
        expect(capturedHeaders!.get('Authorization')).toBe(
          'Bearer fake-oauth-token-123',
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('substitui o header dummy do OpenAI SDK', async () => {
      const originalFetch = globalThis.fetch
      let capturedHeaders: Headers | null = null

      globalThis.fetch = mock(async (input: any, init?: any) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response('ok')
      }) as any

      try {
        const fetchFn = createVertexFetch('/path/to/sa.json')
        // Simula o que o OpenAI SDK faz: seta Authorization: Bearer vertex
        await fetchFn('https://vertex.googleapis.com/v1/test', {
          headers: {
            Authorization: 'Bearer vertex',
            'Content-Type': 'application/json',
          },
        })

        expect(capturedHeaders!.get('Authorization')).toBe(
          'Bearer fake-oauth-token-123',
        )
        expect(capturedHeaders!.get('Content-Type')).toBe('application/json')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('preserva outros headers além do Authorization', async () => {
      const originalFetch = globalThis.fetch
      let capturedHeaders: Headers | null = null

      globalThis.fetch = mock(async (input: any, init?: any) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response('ok')
      }) as any

      try {
        const fetchFn = createVertexFetch('/path/to/sa.json')
        await fetchFn('https://vertex.googleapis.com/v1/test', {
          headers: {
            Authorization: 'Bearer vertex',
            'Content-Type': 'application/json',
            'X-Custom': 'my-value',
          },
        })

        expect(capturedHeaders!.get('X-Custom')).toBe('my-value')
        expect(capturedHeaders!.get('Content-Type')).toBe('application/json')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('passa URL e body corretamente para o fetch original', async () => {
      const originalFetch = globalThis.fetch
      let capturedUrl: any = null
      let capturedBody: any = null

      globalThis.fetch = mock(async (input: any, init?: any) => {
        capturedUrl = input
        capturedBody = init?.body
        return new Response('ok')
      }) as any

      try {
        const fetchFn = createVertexFetch('/path/to/sa.json')
        await fetchFn('https://vertex.googleapis.com/v1/test', {
          method: 'POST',
          body: JSON.stringify({ prompt: 'hello' }),
          headers: { 'Content-Type': 'application/json' },
        })

        expect(capturedUrl).toBe('https://vertex.googleapis.com/v1/test')
        expect(capturedBody).toBe(JSON.stringify({ prompt: 'hello' }))
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
