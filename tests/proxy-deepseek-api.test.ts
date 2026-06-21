import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — devem ser declarados ANTES do import do módulo sob teste.
// ─────────────────────────────────────────────────────────────────────────────

// Mock de getDeepSeekHeaders para não abrir browser real.
// Retorna headers e IDs fixos e previsíveis para os testes.
mock.module('../src/agent/providers/proxy/browser/headers.js', () => ({
  getDeepSeekHeaders: mock(async () => ({
    headers: {
      authorization: 'Bearer test-token',
      cookie: 'session=abc123',
      'x-ds-pow-response': 'pow-value',
    },
    chatSessionId: 'test-session-id-001',
    parentMessageId: null,
  })),
  updateSessionParent: mock(() => {}),
  getSessionParent: mock(() => null),
}))

mock.module('../src/agent/providers/proxy/browser/sessionParent.js', () => ({
  updateSessionParent: mock(() => {}),
  getSessionParent: mock(() => null),
}))

// Mock global de fetch para não fazer requisições reais.
// Retorna um ReadableStream fake com um chunk de dados mínimo.
const fakeStreamBody = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'))
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
    controller.close()
  },
})

const mockFetch = mock(async (_url: string, _init?: RequestInit) =>
  new Response(fakeStreamBody, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }),
)

// Substitui o fetch global antes de cada teste e restaura depois.
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch
  mockFetch.mockClear()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ─────────────────────────────────────────────────────────────────────────────
// Import do módulo sob teste (ainda NÃO existe — todos os testes devem FALHAR)
// ─────────────────────────────────────────────────────────────────────────────

const apiModule = await import('../src/agent/providers/proxy/services/deepseek-api.js').catch(
  () => null,
)

// ─────────────────────────────────────────────────────────────────────────────
// Helper — acessa exports com segurança mesmo quando o módulo não existe
// ─────────────────────────────────────────────────────────────────────────────

function getExport(name: string): unknown {
  if (!apiModule) return undefined
  return (apiModule as Record<string, unknown>)[name]
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Exports do módulo
// ─────────────────────────────────────────────────────────────────────────────

describe('proxy/services/deepseek-api', () => {
  describe('module exports', () => {
    it('should export createDeepSeekStream as a function', () => {
      const fn = getExport('createDeepSeekStream')
      expect(typeof fn).toBe('function')
    })

    it('should export buildPayload as a function', () => {
      const fn = getExport('buildPayload')
      expect(typeof fn).toBe('function')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 2: buildPayload — contrato de construção do payload
  // ─────────────────────────────────────────────────────────────────────────

  describe('buildPayload', () => {
    type BuildPayloadFn = (
      options: { prompt: string; enableThinking: boolean; isProModel?: boolean },
      chatSessionId: string,
      parentMessageId: number | null,
    ) => Record<string, unknown>

    function getBuildPayload(): BuildPayloadFn {
      const fn = getExport('buildPayload')
      expect(fn).toBeDefined()
      return fn as BuildPayloadFn
    }

    it('should include thinking_enabled: true when enableThinking is true', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: true },
        'session-abc',
        null,
      )
      expect(result['thinking_enabled']).toBe(true)
    })

    it('should always include thinking_enabled: true regardless of enableThinking', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false },
        'session-abc',
        null,
      )
      expect(result['thinking_enabled']).toBe(true)
    })

    it('should include model_type: "expert" when isProModel is true', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false, isProModel: true },
        'session-abc',
        null,
      )
      expect(result['model_type']).toBe('expert')
    })

    it('should include model_type: null when isProModel is false', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false, isProModel: false },
        'session-abc',
        null,
      )
      expect(result['model_type']).toBeNull()
    })

    it('should include model_type: null when isProModel is omitted', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false },
        'session-abc',
        null,
      )
      expect(result['model_type']).toBeNull()
    })

    it('should include chat_session_id from the chatSessionId argument', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false },
        'my-unique-session-xyz',
        null,
      )
      expect(result['chat_session_id']).toBe('my-unique-session-xyz')
    })

    it('should include parent_message_id from the parentMessageId argument when it is a number', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false },
        'session-abc',
        42,
      )
      expect(result['parent_message_id']).toBe(42)
    })

    it('should include parent_message_id as null when parentMessageId is null', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false },
        'session-abc',
        null,
      )
      expect(result['parent_message_id']).toBeNull()
    })

    it('should include the prompt from options', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'What is the meaning of life?', enableThinking: false },
        'session-abc',
        null,
      )
      expect(result['prompt']).toBe('What is the meaning of life?')
    })

    it('should include search_enabled: true by default', () => {
      const buildPayload = getBuildPayload()
      const result = buildPayload(
        { prompt: 'hello', enableThinking: false },
        'session-abc',
        null,
      )
      expect(result['search_enabled']).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 3: createDeepSeekStream — contrato de retorno e integração
  // ─────────────────────────────────────────────────────────────────────────

  describe('createDeepSeekStream', () => {
    type CreateDeepSeekStreamFn = (options: {
      prompt: string
      enableThinking: boolean
      isProModel?: boolean
      forcedParentId?: number | null
    }) => Promise<{
      stream: ReadableStream
      chatSessionId: string
      parentMessageId: number | null
    }>

    function getCreateDeepSeekStream(): CreateDeepSeekStreamFn {
      const fn = getExport('createDeepSeekStream')
      expect(fn).toBeDefined()
      return fn as CreateDeepSeekStreamFn
    }

    it('should return an object with a stream property that is a ReadableStream', async () => {
      const createDeepSeekStream = getCreateDeepSeekStream()
      const result = await createDeepSeekStream({ prompt: 'hello', enableThinking: false })
      expect(result.stream).toBeInstanceOf(ReadableStream)
    })

    it('should return an object with a chatSessionId string property', async () => {
      const createDeepSeekStream = getCreateDeepSeekStream()
      const result = await createDeepSeekStream({ prompt: 'hello', enableThinking: false })
      expect(typeof result.chatSessionId).toBe('string')
      expect(result.chatSessionId.length).toBeGreaterThan(0)
    })

    it('should return an object with parentMessageId as number or null', async () => {
      const createDeepSeekStream = getCreateDeepSeekStream()
      const result = await createDeepSeekStream({ prompt: 'hello', enableThinking: false })
      const isValid = result.parentMessageId === null || typeof result.parentMessageId === 'number'
      expect(isValid).toBe(true)
    })

    it('should call getDeepSeekHeaders internally (mock must be invoked)', async () => {
      const headersModule = await import('../src/agent/providers/proxy/browser/headers.js').catch(
        () => null,
      )
      const getDeepSeekHeaders = headersModule
        ? (headersModule as Record<string, unknown>)['getDeepSeekHeaders'] as ReturnType<typeof mock>
        : undefined

      expect(getDeepSeekHeaders).toBeDefined()
      getDeepSeekHeaders!.mockClear()

      const createDeepSeekStream = getCreateDeepSeekStream()
      await createDeepSeekStream({ prompt: 'test prompt', enableThinking: false })

      expect(getDeepSeekHeaders!.mock.calls.length).toBeGreaterThan(0)
    })

    it('should call fetch with the DeepSeek API endpoint', async () => {
      const createDeepSeekStream = getCreateDeepSeekStream()
      await createDeepSeekStream({ prompt: 'test', enableThinking: false })

      expect(mockFetch.mock.calls.length).toBeGreaterThan(0)
      const calledUrl = mockFetch.mock.calls[0]![0] as string
      expect(calledUrl).toContain('/api/v0/chat/completion')
    })
  })
})
