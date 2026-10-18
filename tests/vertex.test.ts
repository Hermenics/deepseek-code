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
  listVertexDeepSeekModels,
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
    it('calls GoogleAuth with the correct keyFile and scopes', async () => {
      await getVertexAccessToken('/path/to/sa.json')

      expect(constructorCalls).toHaveLength(1)
      expect(constructorCalls[0]).toEqual({
        keyFile: '/path/to/sa.json',
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      })
    })

    it('returns the generated access token', async () => {
      const token = await getVertexAccessToken('/path/to/sa.json')
      expect(token).toBe('fake-oauth-token-123')
    })

    it('checks abort after non-cancellable GoogleAuth token acquisition completes', async () => {
      let finishToken!: (value: { token: string }) => void
      mockGetAccessToken.mockImplementationOnce(() => new Promise(resolve => { finishToken = resolve }))
      const controller = new AbortController()
      const pending = getVertexAccessToken('/path/to/sa.json', controller.signal)
      await Bun.sleep(0)
      controller.abort(new Error('cancelled'))
      finishToken({ token: 'late-token' })
      await expect(pending).rejects.toThrow('cancelled')
    })

    it('returns the cached token while it is still valid', async () => {
      // First call generates a token.
      await getVertexAccessToken('/path/to/sa.json')
      // Second call should use the cache.
      await getVertexAccessToken('/path/to/sa.json')

      // The GoogleAuth constructor should have been called only once.
      expect(mockGetAccessToken).toHaveBeenCalledTimes(1)
    })

    it('generates a new token when the cache expires', async () => {
      // First call.
      await getVertexAccessToken('/path/to/sa.json')

      // Simulate cache expiration by manipulating the clock.
      // Advance one hour (the token expires in 3600s, with a 5-minute buffer).
      const originalNow = Date.now
      Date.now = () => originalNow() + 3600 * 1000

      try {
        await getVertexAccessToken('/path/to/sa.json')
        expect(mockGetAccessToken).toHaveBeenCalledTimes(2)
      } finally {
        Date.now = originalNow
      }
    })

    it('generates a new token when less than 5 minutes remain before expiration', async () => {
      await getVertexAccessToken('/path/to/sa.json')

      // Advance 56 minutes (3360s), leaving 4 minutes within the 5-minute buffer.
      const originalNow = Date.now
      Date.now = () => originalNow() + 3360 * 1000

      try {
        await getVertexAccessToken('/path/to/sa.json')
        expect(mockGetAccessToken).toHaveBeenCalledTimes(2)
      } finally {
        Date.now = originalNow
      }
    })

    it('throws when getAccessToken returns a null token', async () => {
      mockGetAccessToken.mockImplementation(() =>
        Promise.resolve({ token: null as unknown as string }),
      )

      expect(getVertexAccessToken('/path/to/sa.json')).rejects.toThrow(
        'Failed to obtain Vertex AI access token',
      )
    })
  })

  describe('clearTokenCache', () => {
    it('clears the cache to force token regeneration', async () => {
      await getVertexAccessToken('/path/to/sa.json')
      clearTokenCache()
      await getVertexAccessToken('/path/to/sa.json')

      expect(mockGetAccessToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('createVertexFetch', () => {
    it('returns a function', () => {
      const fetchFn = createVertexFetch('/path/to/sa.json')
      expect(typeof fetchFn).toBe('function')
    })

    it('sets the Authorization header with the real Bearer token', async () => {
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

    it('replaces the OpenAI SDK dummy header', async () => {
      const originalFetch = globalThis.fetch
      let capturedHeaders: Headers | null = null

      globalThis.fetch = mock(async (input: any, init?: any) => {
        capturedHeaders = new Headers(init?.headers)
        return new Response('ok')
      }) as any

      try {
        const fetchFn = createVertexFetch('/path/to/sa.json')
        // Simulate the OpenAI SDK setting Authorization: Bearer vertex.
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

    it('preserves headers other than Authorization', async () => {
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

    it('passes the URL and body to the original fetch correctly', async () => {
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

  describe('listVertexDeepSeekModels', () => {
    it('passes the abort signal to the cancellable catalog fetch', async () => {
      const originalFetch = globalThis.fetch
      const controller = new AbortController()
      let receivedSignal: AbortSignal | undefined
      let requestStarted!: () => void
      const started = new Promise<void>(resolve => { requestStarted = resolve })
      globalThis.fetch = mock(async (_input: any, init?: RequestInit) => {
        receivedSignal = init?.signal ?? undefined
        requestStarted()
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }) as any

      try {
        const pending = listVertexDeepSeekModels('fixture-project', 'us-central1', '/path/to/sa.json', controller.signal)
        await started
        expect(receivedSignal).toBe(controller.signal)
        controller.abort(new Error('cancelled'))
        await expect(pending).rejects.toThrow('cancelled')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })
})
