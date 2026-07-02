import { describe, it, expect, mock, beforeEach, afterEach, beforeAll } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks, ToolPermissionResult } from '../src/agent/agent.js'

// Helper: injeta um client mockado no Agent via cast (mesmo padrão de reasoning.test.ts)
function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

// Helper: resolve o readyPromise para não aguardar inicialização assíncrona real
function resolveReady(agent: Agent) {
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
}

// Helper: cria um async iterable a partir de chunks
async function* makeStream(chunks: object[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

// Helper: cria um async iterable que lança erro após alguns chunks
async function* makeErrorStream(chunks: object[], error: Error) {
  for (const chunk of chunks) {
    yield chunk
  }
  throw error
}

// Agent requires an API key to instantiate the OpenAI client
beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

// Helper: create a no-op callbacks object
function createMockCallbacks(): AgentCallbacks & { tokens: string[]; toolCalls: string[]; done: boolean } {
  const state = { tokens: [] as string[], toolCalls: [] as string[], done: false }
  return {
    ...state,
    onToken(text: string) { state.tokens.push(text) },
    onToolCall(name: string) { state.toolCalls.push(name) },
    onToolResult() {},
    onDone() { state.done = true },
  }
}

describe('Agent class', () => {
  describe('constructor', () => {
    it('should create an agent with default config', () => {
      const agent = new Agent()
      expect(agent.model).toBe('deepseek-v4-flash')
      expect(agent.activeAgent).toBeNull()
      expect(agent.provider).toBe('deepseek')
    })

    it('should accept provider config', () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      expect(agent.provider).toBe('deepseek')
    })
  })

  describe('setModel', () => {
    it('should change the model', () => {
      const agent = new Agent()
      agent.setModel('deepseek-reasoner')
      expect(agent.model).toBe('deepseek-reasoner')
    })

    it('should update context limit when changing model', () => {
      const agent = new Agent()
      agent.setModel('deepseek-reasoner')
      expect(agent.contextLimit).toBe(1_000_000)
    })

    it('should accept arbitrary model string', () => {
      const agent = new Agent()
      agent.setModel('gpt-4-turbo')
      expect(agent.model).toBe('gpt-4-turbo')
    })

    it('should use default context limit for unknown model', () => {
      const agent = new Agent()
      agent.setModel('some-unknown-model-xyz')
      expect(agent.contextLimit).toBe(1_000_000)
    })

    it('should accept model with slash (provider/model format)', () => {
      const agent = new Agent()
      agent.setModel('google/gemini-2.0-flash-001')
      expect(agent.model).toBe('google/gemini-2.0-flash-001')
    })
  })

  describe('clearHistory', () => {
    it('should reset messages to only system prompt', () => {
      const agent = new Agent()
      agent.clearHistory()
      const messages = agent.getMessages()
      expect(messages.length).toBe(1)
      expect(messages[0].role).toBe('system')
    })
  })

  describe('getFilesModified', () => {
    it('should return empty array initially', () => {
      const agent = new Agent()
      expect(agent.getFilesModified()).toEqual([])
    })
  })

  describe('getSystemPrompt', () => {
    it('should return a non-empty string', () => {
      const agent = new Agent()
      const prompt = agent.getSystemPrompt()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(100)
    })
  })

  describe('getToolNames', () => {
    it('should return array of tool names', () => {
      const agent = new Agent()
      const names = agent.getToolNames()
      expect(names).toBeArray()
      expect(names.length).toBeGreaterThan(0)
      expect(names).toContain('read_file')
      expect(names).toContain('write_file')
      expect(names).toContain('shell')
    })
  })

  describe('getCostSummary', () => {
    it('should return formatted cost string', () => {
      const agent = new Agent()
      const summary = agent.getCostSummary()
      expect(summary).toContain('Model:')
      expect(summary).toContain('Tokens:')
      expect(summary).toContain('Estimated cost:')
    })
  })

  describe('getLastUserMessage', () => {
    it('should return null initially', () => {
      const agent = new Agent()
      expect(agent.getLastUserMessage()).toBeNull()
    })
  })

  describe('setLanguage', () => {
    it('should add language instruction to system prompt', () => {
      const agent = new Agent()
      agent.setLanguage('Portuguese')
      const prompt = agent.getSystemPrompt()
      expect(prompt).toContain('PREFERRED LANGUAGE')
      expect(prompt).toContain('Portuguese')
    })

    it('should replace existing language instruction', () => {
      const agent = new Agent()
      agent.setLanguage('English')
      agent.setLanguage('Portuguese')
      const prompt = agent.getSystemPrompt()
      expect(prompt).toContain('Portuguese')
      expect(prompt).not.toContain('Always respond in English')
    })
  })

  describe('loadSessionMessages', () => {
    it('should replace current messages', () => {
      const agent = new Agent()
      const newMessages = [
        { role: 'system' as const, content: 'custom prompt' },
        { role: 'user' as const, content: 'hello' },
      ]
      agent.loadSessionMessages(newMessages)
      expect(agent.getMessages()).toEqual(newMessages)
    })
  })

  describe('applyAgentConfig', () => {
    it('should set active agent name', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        systemPrompt: 'You are a test agent.',
      })
      expect(agent.activeAgent).toBe('test-agent')
    })

    it('should set model from config', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        model: 'deepseek-reasoner',
        systemPrompt: 'Test prompt.',
      })
      expect(agent.model).toBe('deepseek-reasoner')
    })

    it('should clear history when applying config', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        systemPrompt: 'New system prompt.',
      })
      const messages = agent.getMessages()
      expect(messages.length).toBe(1)
      expect(messages[0].content).toBe('New system prompt.')
    })
  })

  describe('resetAgent', () => {
    it('should reset to defaults', async () => {
      const agent = new Agent()
      await agent.applyAgentConfig({
        name: 'test-agent',
        model: 'deepseek-reasoner',
        systemPrompt: 'Custom.',
      })
      agent.resetAgent()
      expect(agent.activeAgent).toBeNull()
      expect(agent.model).toBe('deepseek-v4-flash')
    })
  })

  describe('undo', () => {
    it('should return "Nothing to undo." when stack is empty', async () => {
      const agent = new Agent()
      const result = await agent.undo()
      expect(result).toBe('Nothing to undo.')
    })
  })

  describe('setConfirmHandler', () => {
    it('should accept null handler', () => {
      const agent = new Agent()
      expect(() => agent.setConfirmHandler(null)).not.toThrow()
    })

    it('should accept function handler', () => {
      const agent = new Agent()
      const handler = async () => true
      expect(() => agent.setConfirmHandler(handler)).not.toThrow()
    })
  })

  describe('setToolPermissionHandler', () => {
    it('should accept null handler', () => {
      const agent = new Agent()
      expect(() => agent.setToolPermissionHandler(null)).not.toThrow()
    })

    it('should accept function handler', () => {
      const agent = new Agent()
      const handler = async (): Promise<ToolPermissionResult> => 'once'
      expect(() => agent.setToolPermissionHandler(handler)).not.toThrow()
    })
  })

  describe('addNote', () => {
    it('should not throw when adding a note', () => {
      const agent = new Agent()
      expect(() => agent.addNote('fix the bug later')).not.toThrow()
    })

    it('should accept multiple notes', () => {
      const agent = new Agent()
      expect(() => {
        agent.addNote('note 1')
        agent.addNote('note 2')
        agent.addNote('note 3')
      }).not.toThrow()
    })
  })

  describe('getStats', () => {
    it('should return a string with session statistics', () => {
      const agent = new Agent()
      const stats = agent.getStats()
      expect(typeof stats).toBe('string')
      expect(stats).toContain('Duration')
      expect(stats).toContain('Model')
      expect(stats).toContain('Tokens')
      expect(stats).toContain('Tool calls')
      expect(stats).toContain('Cost')
    })

    it('should include provider info', () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test' })
      const stats = agent.getStats()
      expect(stats).toContain('deepseek')
    })
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Testes de propagação de erro do Agent.run()
// Contexto: erros da API (401, 503, stream quebrado) devem propagar via rejeição
// da promise retornada por run(). O bug reportado está na UI que não captura
// esses erros — aqui confirmamos que o Agent já os propaga corretamente.
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent error propagation', () => {
  // Callbacks com mocks rastreáveis para verificar que onDone NÃO é chamado em erro
  function makeTrackedCallbacks() {
    return {
      onToken: mock((_text: string) => {}),
      onToolCall: mock((_name: string) => {}),
      onToolResult: mock((_name: string, _result: string) => {}),
      onDone: mock(() => {}),
    }
  }

  describe('run(): erros da API devem propagar', () => {
    it('should reject with API error and NOT call onDone when create throws 401', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const apiError = new Error('401 Unauthorized')
      ;(apiError as unknown as Record<string, unknown>).status = 401

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => { throw apiError }),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('401 Unauthorized')
      expect(cb.onDone).not.toHaveBeenCalled()
    })

    it('should reject with API error and NOT call onDone when create throws generic auth error', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const authError = new Error('Authentication failed: invalid API key')

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => { throw authError }),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('Authentication failed')
      expect(cb.onDone).not.toHaveBeenCalled()
    })
  })

  describe('run(): erros de rede após retries esgotados devem propagar', () => {
    it('should reject after retries are exhausted when create throws 503', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const networkError = new Error('Service Unavailable')
      ;(networkError as unknown as Record<string, unknown>).status = 503

      // withRetry tenta 4 vezes (attempt 0..3) para status 503 — o mock sempre falha
      const createMock = mock(() => { throw networkError })

      injectMockClient(agent, {
        chat: {
          completions: {
            // Substitui os delays de retry para o teste não demorar
            create: createMock,
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      // Substitui os delays do withRetry por zero para o teste ser rápido
      ;(agent as unknown as Record<string, unknown>).withRetry = async (fn: () => Promise<unknown>) => {
        const delays = [0, 0, 0]
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            return await fn()
          } catch (e: unknown) {
            const err = e as { status?: number }
            if ((err.status === 503) && attempt < delays.length) continue
            throw e
          }
        }
        throw new Error('unreachable')
      }

      const cb = makeTrackedCallbacks()

      // Act + Assert — deve rejeitar após esgotar retries
      await expect(agent.run('hello', cb)).rejects.toThrow('Service Unavailable')
      expect(cb.onDone).not.toHaveBeenCalled()
      // Confirma que tentou múltiplas vezes (4 tentativas: attempt 0, 1, 2, 3)
      expect(createMock).toHaveBeenCalledTimes(4)
    }, 10_000)
  })

  describe('run(): erros no meio do stream devem propagar', () => {
    it('should reject when stream throws mid-iteration', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const streamError = new Error('Stream connection reset')

      // Stream emite um chunk válido e depois lança erro
      const brokenStream = makeErrorStream(
        [
          { choices: [{ delta: { content: 'Olá' } }] },
        ],
        streamError,
      )

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => brokenStream),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('Stream connection reset')
      expect(cb.onDone).not.toHaveBeenCalled()
    })

    it('should reject when stream throws immediately without any chunks', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const streamError = new Error('Connection refused')

      const emptyBrokenStream = makeErrorStream([], streamError)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => emptyBrokenStream),
          },
        },
        models: {
          list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })),
        },
      })

      const cb = makeTrackedCallbacks()

      // Act + Assert
      await expect(agent.run('hello', cb)).rejects.toThrow('Connection refused')
      expect(cb.onDone).not.toHaveBeenCalled()
    })
  })
})
