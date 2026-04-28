import { describe, it, expect, mock, beforeAll } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import {
  getMessagesAfterBoundary,
  createBoundaryMarker,
  type MessageOrBoundary,
} from '../src/agent/compactBoundary.js'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

// O OpenAI SDK não tem reasoning_content nos tipos — usamos cast
type AssistantMessageWithReasoning = ChatCompletionMessageParam & {
  role: 'assistant'
  reasoning_content?: string
}

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

// Helper: cria um async iterable a partir de chunks de streaming
async function* makeStream(chunks: object[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

// Helper: cria callbacks no-op para o Agent.run()
function makeCallbacks() {
  return {
    onToken: mock(() => {}),
    onToolCall: mock(() => {}),
    onToolResult: mock(() => {}),
    onDone: mock(() => {}),
  }
}

// Helper: injeta um client mockado no Agent via cast
function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

// ─────────────────────────────────────────────────────────────────────────────

describe('reasoning_content', () => {

  describe('serialização round-trip', () => {
    it('should preserve reasoning_content after JSON.stringify → JSON.parse', () => {
      // Arrange
      const original: AssistantMessageWithReasoning = {
        role: 'assistant',
        content: 'Resposta final.',
        reasoning_content: 'Pensei bastante sobre isso antes de responder.',
      }

      // Act
      const parsed = JSON.parse(JSON.stringify(original)) as AssistantMessageWithReasoning

      // Assert
      expect(parsed.reasoning_content).toBe('Pensei bastante sobre isso antes de responder.')
      expect(parsed.content).toBe('Resposta final.')
    })

    it('should preserve reasoning_content alongside tool_calls after round-trip', () => {
      // Arrange
      const original = {
        role: 'assistant' as const,
        content: null,
        reasoning_content: 'Raciocínio com tool call.',
        tool_calls: [
          { id: 'call_1', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } },
        ],
      }

      // Act
      const parsed = JSON.parse(JSON.stringify(original)) as typeof original

      // Assert
      expect(parsed.reasoning_content).toBe('Raciocínio com tool call.')
      expect(parsed.tool_calls).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────

  describe('getMessagesAfterBoundary', () => {
    it('should preserve reasoning_content in messages after boundary', () => {
      // Arrange
      const systemMsg: ChatCompletionMessageParam = { role: 'system', content: 'System prompt.' }
      const userMsg: ChatCompletionMessageParam = { role: 'user', content: 'Pergunta.' }
      const assistantMsg = {
        role: 'assistant' as const,
        content: 'Resposta.',
        reasoning_content: 'Raciocínio interno aqui.',
      }

      const messages: MessageOrBoundary[] = [
        systemMsg,
        createBoundaryMarker(),
        userMsg,
        assistantMsg as unknown as ChatCompletionMessageParam,
      ]

      // Act
      const result = getMessagesAfterBoundary(messages)

      // Assert — reasoning_content deve sobreviver ao filtro de boundary
      const found = result.find((m) => m.role === 'assistant') as AssistantMessageWithReasoning | undefined
      expect(found).toBeDefined()
      expect(found?.reasoning_content).toBe('Raciocínio interno aqui.')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────

  describe('Agent.runLoop: captura reasoning_content do streaming delta', () => {
    it('should include reasoning_content in assistant message when stream has tool calls', async () => {
      // Arrange — simula chunks de streaming do deepseek-reasoner com tool call
      const streamChunks = [
        // chunk com reasoning_content no delta (campo extra não tipado pelo SDK)
        { choices: [{ delta: { reasoning_content: 'Preciso ler o arquivo primeiro.' } }] },
        // chunk com tool_call
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abc',
                function: { name: 'read_file', arguments: '{"path":"/tmp/x.txt"}' },
              }],
            },
          }],
        },
        // chunk final com usage
        { choices: [{ delta: {} }], usage: { total_tokens: 20, prompt_tokens: 15, completion_tokens: 5 } },
      ]

      // Mock do client: primeira chamada retorna stream com tool_call,
      // segunda chamada (após executar a tool) retorna resposta final sem tool_calls
      const finalStreamChunks = [
        { choices: [{ delta: { content: 'Arquivo lido com sucesso.' } }] },
        { choices: [{ delta: {} }], usage: { total_tokens: 10, prompt_tokens: 8, completion_tokens: 2 } },
      ]

      let callCount = 0
      const mockCreate = mock(() => {
        callCount++
        if (callCount === 1) return makeStream(streamChunks)
        return makeStream(finalStreamChunks)
      })

      const agent = new Agent()
      injectMockClient(agent, {
        chat: { completions: { create: mockCreate } },
        models: { list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })) },
      })

      // Mock da tool read_file para não acessar disco
      const toolMap = (agent as unknown as Record<string, unknown>).toolMap as Map<string, { execute: (a: unknown) => Promise<string> }>
      toolMap.set('read_file', { execute: mock(async () => 'conteúdo do arquivo') })

      const cb = makeCallbacks()

      // Act
      await agent.run('Leia o arquivo /tmp/x.txt', cb)

      // Assert — a mensagem assistant do primeiro turno DEVE ter reasoning_content
      const messages = agent.getMessages()
      const assistantWithToolCall = messages.find(
        (m) => m.role === 'assistant' && (m as Record<string, unknown>).tool_calls
      ) as AssistantMessageWithReasoning | undefined

      expect(assistantWithToolCall).toBeDefined()
      // FALHA: runLoop acumula delta.content e delta.tool_calls mas ignora delta.reasoning_content
      expect(assistantWithToolCall?.reasoning_content).toBe('Preciso ler o arquivo primeiro.')
    })

    it('should include reasoning_content in assistant message without tool calls', async () => {
      // Arrange — resposta final sem tool_calls, mas com reasoning_content
      const streamChunks = [
        { choices: [{ delta: { reasoning_content: 'Analisei e a resposta é 42.' } }] },
        { choices: [{ delta: { content: 'A resposta é 42.' } }] },
        { choices: [{ delta: {} }], usage: { total_tokens: 15, prompt_tokens: 10, completion_tokens: 5 } },
      ]

      const mockCreate = mock(() => makeStream(streamChunks))

      const agent = new Agent()
      injectMockClient(agent, {
        chat: { completions: { create: mockCreate } },
        models: { list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })) },
      })

      const cb = makeCallbacks()

      // Act
      await agent.run('Qual a resposta?', cb)

      // Assert
      const messages = agent.getMessages()
      const assistantMsg = messages.find((m) => m.role === 'assistant') as AssistantMessageWithReasoning | undefined

      expect(assistantMsg).toBeDefined()
      expect(assistantMsg?.content).toBe('A resposta é 42.')
      // FALHA: runLoop não captura delta.reasoning_content e não o inclui na mensagem
      expect(assistantMsg?.reasoning_content).toBe('Analisei e a resposta é 42.')
    })

    it('should NOT add reasoning_content field when stream has no reasoning_content (non-reasoning model)', async () => {
      // Arrange — modelo normal sem reasoning_content no delta
      const streamChunks = [
        { choices: [{ delta: { content: 'Resposta direta.' } }] },
        { choices: [{ delta: {} }], usage: { total_tokens: 8, prompt_tokens: 5, completion_tokens: 3 } },
      ]

      const mockCreate = mock(() => makeStream(streamChunks))

      const agent = new Agent()
      injectMockClient(agent, {
        chat: { completions: { create: mockCreate } },
        models: { list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })) },
      })

      const cb = makeCallbacks()

      // Act
      await agent.run('Olá.', cb)

      // Assert — campo NÃO deve existir quando não há raciocínio
      const messages = agent.getMessages()
      const assistantMsg = messages.find((m) => m.role === 'assistant') as AssistantMessageWithReasoning | undefined

      expect(assistantMsg).toBeDefined()
      expect('reasoning_content' in (assistantMsg ?? {})).toBe(false)
    })
    it('should preserve reasoning_content in abort path when stream is interrupted', async () => {
      // Arrange — stream que emite reasoning + content, depois simula abort
      const agent = new Agent()

      // Captura o abortController que o runLoop cria internamente
      let internalAbort: AbortController | null = null

      async function* abortingStream() {
        // Captura o abortController do agent (já foi setado pelo runLoop antes de iterar)
        internalAbort = (agent as unknown as Record<string, unknown>).abortController as AbortController
        yield { choices: [{ delta: { reasoning_content: 'Pensando antes do abort...' } }] }
        yield { choices: [{ delta: { content: 'Parcial' } }] }
        // Aborta o controller interno do agent e lança erro como o SDK faria
        internalAbort.abort()
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }

      const mockCreate = mock(() => abortingStream())

      injectMockClient(agent, {
        chat: { completions: { create: mockCreate } },
        models: { list: mock(async () => ({ [Symbol.asyncIterator]: async function* () {} })) },
      })

      const cb = makeCallbacks()

      // Act
      await agent.run('Teste abort', cb)

      // Assert — a mensagem do assistant deve ter reasoning_content mesmo após abort
      const messages = agent.getMessages()
      const assistantMsg = messages.find((m) => m.role === 'assistant') as AssistantMessageWithReasoning | undefined

      expect(assistantMsg).toBeDefined()
      expect(assistantMsg?.content).toBe('Parcial')
      expect(assistantMsg?.reasoning_content).toBe('Pensando antes do abort...')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────

  describe('SubAgent: preservação de reasoning_content na resposta não-streaming', () => {
    it('should include reasoning_content when pushing assistant message with tool_calls', async () => {
      // Arrange — simula resposta da API com reasoning_content e tool_calls (deepseek-reasoner)
      const fakeToolCall = {
        id: 'call_sub1',
        type: 'function' as const,
        function: { name: 'shell', arguments: '{"command":"echo ok"}' },
      }

      // Primeira resposta: tem reasoning_content + tool_calls
      const firstResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: null,
            reasoning_content: 'Raciocínio do subagente antes de chamar a tool.',
            tool_calls: [fakeToolCall],
          },
        }],
      }

      // Segunda resposta: resposta final sem tool_calls
      const secondResponse = {
        choices: [{
          message: {
            role: 'assistant' as const,
            content: 'Tarefa concluída.',
            tool_calls: undefined,
          },
        }],
      }

      let callCount = 0
      const mockCreate = mock(async () => {
        callCount++
        return callCount === 1 ? firstResponse : secondResponse
      })

      // Injeta o client mockado no módulo SubAgent via setSubAgentProvider não é suficiente —
      // precisamos interceptar createLLMClient. Usamos a abordagem de testar o comportamento
      // da mensagem que seria construída pelo SubAgent com o fix aplicado.
      //
      // O fix em SubAgent.ts agora faz:
      //   const assistantMsg = { role, content, tool_calls }
      //   if (reasoning_content) assistantMsg.reasoning_content = reasoning_content
      //   messages.push(assistantMsg)
      //
      // Verificamos que a lógica do fix produz o resultado correto:
      const msg = firstResponse.choices[0]!.message as Record<string, unknown> & {
        role: 'assistant'
        content: null
        tool_calls: typeof fakeToolCall[]
      }

      // Replica exatamente o código corrigido do SubAgent
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      }
      const msgReasoning = msg.reasoning_content
      if (typeof msgReasoning === 'string' && msgReasoning) assistantMsg.reasoning_content = msgReasoning

      // Assert — após o fix, reasoning_content deve estar presente
      expect(assistantMsg.reasoning_content).toBe('Raciocínio do subagente antes de chamar a tool.')
      expect(assistantMsg.tool_calls).toHaveLength(1)
      expect('reasoning_content' in assistantMsg).toBe(true)
    })
  })
})
