import { describe, it, expect, mock, beforeAll } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks } from '../src/agent/agent.js'
import type { ProviderConfig } from '../src/ui/setup/ApiKeySetup.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

/** Injeta um client mockado no Agent via cast (mesmo padrão de agent.test.ts) */
function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

/** Resolve o readyPromise para não aguardar inicialização assíncrona real */
function resolveReady(agent: Agent) {
  ;(agent as unknown as Record<string, unknown>).readyPromise = Promise.resolve()
}

/** Cria um async iterable a partir de chunks */
async function* makeStream(chunks: object[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

/** Cria callbacks rastreáveis com estado interno */
function makeTrackedCallbacks(): AgentCallbacks & {
  tokens: string[]
  toolCalls: Array<{ name: string; args: object }>
  toolResults: Array<{ name: string; result: string; args: Record<string, unknown> }>
  doneCount: number
} {
  const state = {
    tokens: [] as string[],
    toolCalls: [] as Array<{ name: string; args: object }>,
    toolResults: [] as Array<{ name: string; result: string; args: Record<string, unknown> }>,
    doneCount: 0,
  }
  return {
    get tokens() { return state.tokens },
    get toolCalls() { return state.toolCalls },
    get toolResults() { return state.toolResults },
    get doneCount() { return state.doneCount },
    onToken(text: string) { state.tokens.push(text) },
    onToolCall(name: string, args: object) { state.toolCalls.push({ name, args }) },
    onToolResult(name: string, result: string, args: Record<string, unknown>) {
      state.toolResults.push({ name, result, args })
    },
    onDone() { state.doneCount++ },
  }
}

/** Cria um mock de tool para injetar no toolMap do Agent */
function makeToolMock(name: string, result: string) {
  const argumentName = name === 'shell' ? 'command' : name === 'grep' || name === 'glob' ? 'pattern' : 'path'
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: { [argumentName]: { type: 'string' } } },
    execute: mock(() => Promise.resolve(result)),
  }
}

/** Injeta uma tool mockada no toolMap do Agent */
function injectTool(agent: Agent, tool: ReturnType<typeof makeToolMock>) {
  const toolMap = (agent as unknown as Record<string, unknown>).toolMap as Map<string, unknown>
  toolMap.set(tool.name, tool)
}

// ─────────────────────────────────────────────────────────────────────────────
// Testes de streaming
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent streaming callbacks', () => {

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  describe('onToken — happy path', () => {
    it('should call onToken 3 times with correct text when stream has 3 text chunks', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: 'Olá' } }] },
        { choices: [{ delta: { content: ' mundo' } }] },
        { choices: [{ delta: { content: '!' } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.tokens).toHaveLength(3)
      expect(cb.tokens[0]).toBe('Olá')
      expect(cb.tokens[1]).toBe(' mundo')
      expect(cb.tokens[2]).toBe('!')
    })
  })

  // ── 2. Empty delta.content ─────────────────────────────────────────────────
  describe('onToken — empty delta', () => {
    it('should NOT call onToken when delta.content is empty string', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: '' } }] },
        { choices: [{ delta: { content: '' } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.tokens).toHaveLength(0)
    })
  })

  // ── 3. Null delta.content ──────────────────────────────────────────────────
  describe('onToken — null delta', () => {
    it('should NOT call onToken when delta.content is null', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: null } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.tokens).toHaveLength(0)
    })
  })

  // ── 4. Usage-only chunk (choices: []) ─────────────────────────────────────
  describe('usage-only chunk', () => {
    it('should not crash and not call onToken when chunk has empty choices and usage present', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: 'texto' } }] },
        // chunk de usage sem choices — padrão DeepSeek stream_options
        {
          choices: [],
          usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
        },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act — não deve lançar erro
      await agent.run('hello', cb)

      // Assert — só o chunk com conteúdo real dispara onToken
      expect(cb.tokens).toHaveLength(1)
      expect(cb.tokens[0]).toBe('texto')
      expect(cb.doneCount).toBe(1)
    })
  })

  // ── 5. Tool call — onToolCall dispara com nome e args corretos ─────────────
  describe('onToolCall', () => {
    it('should call onToolCall with correct name and parsed args before execution', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const toolArgs = { path: '/tmp/test.txt' }

      // Stream que simula uma tool call completa (args chegam em chunks separados)
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abc123',
                function: { name: 'read_file', arguments: '' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: JSON.stringify(toolArgs) },
              }],
            },
          }],
        },
      ]

      // Mock da tool read_file para não tocar no filesystem
      const readFileMock = makeToolMock('read_file', 'conteúdo do arquivo')
      injectTool(agent, readFileMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock()
              // Primeira chamada: stream com tool call
              .mockImplementationOnce(() => makeStream(chunks))
              // Segunda chamada: stream de resposta final (sem mais tool calls)
              .mockImplementationOnce(() => makeStream([
                { choices: [{ delta: { content: 'Arquivo lido.' } }] },
              ])),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('leia o arquivo', cb)

      // Assert — onToolCall deve ter sido chamado com o nome correto
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_file')
      expect(cb.toolCalls[0]!.args).toEqual(toolArgs)
    })
  })

  // ── 6. Tool result — onToolResult dispara após execução ───────────────────
  describe('onToolResult', () => {
    it('should call onToolResult with correct result after tool execution', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const toolArgs = { path: '/tmp/test.txt' }
      const expectedResult = 'conteúdo do arquivo mockado'

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_xyz789',
                function: { name: 'read_file', arguments: JSON.stringify(toolArgs) },
              }],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', expectedResult)
      injectTool(agent, readFileMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock()
              .mockImplementationOnce(() => makeStream(chunks))
              .mockImplementationOnce(() => makeStream([
                { choices: [{ delta: { content: 'Pronto.' } }] },
              ])),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('leia o arquivo', cb)

      // Assert
      expect(cb.toolResults).toHaveLength(1)
      expect(cb.toolResults[0]!.name).toBe('read_file')
      expect(cb.toolResults[0]!.result).toBe(expectedResult)
      expect(cb.toolResults[0]!.args).toEqual(toolArgs)
    })
  })

  // ── 7. Mixed: texto → tool call → texto — ordem correta ───────────────────
  describe('mixed stream — texto, tool call, texto', () => {
    it('should fire all callbacks in correct order: onToken, onToolCall, onToolResult, onToken, onDone', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const callOrder: string[] = []

      const toolArgs = { command: 'ls' }
      const toolResult = 'arquivo1.txt\narquivo2.txt'

      // Primeira iteração do loop: texto + tool call
      const firstStream = [
        { choices: [{ delta: { content: 'Vou listar os arquivos.' } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_mix001',
                function: { name: 'shell', arguments: JSON.stringify(toolArgs) },
              }],
            },
          }],
        },
      ]

      // Segunda iteração do loop: texto final
      const secondStream = [
        { choices: [{ delta: { content: 'Listagem concluída.' } }] },
      ]

      const shellMock = makeToolMock('shell', toolResult)
      injectTool(agent, shellMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock()
              .mockImplementationOnce(() => makeStream(firstStream))
              .mockImplementationOnce(() => makeStream(secondStream)),
          },
        },
      })

      const cb: AgentCallbacks = {
        onToken(text) { callOrder.push(`token:${text}`) },
        onToolCall(name) { callOrder.push(`toolCall:${name}`) },
        onToolResult(name) { callOrder.push(`toolResult:${name}`) },
        onDone() { callOrder.push('done') },
      }

      // Act
      await agent.run('liste os arquivos', cb)

      // Assert — ordem exata dos eventos
      expect(callOrder[0]).toBe('token:Vou listar os arquivos.')
      expect(callOrder[1]).toBe('toolCall:shell')
      expect(callOrder[2]).toBe('toolResult:shell')
      expect(callOrder[3]).toBe('token:Listagem concluída.')
      expect(callOrder[4]).toBe('done')
    })
  })

  // ── 8. Abort mid-stream — onDone é chamado, sem crash ─────────────────────
  describe('abort mid-stream', () => {
    it('should call onDone and not crash when abort is called after first token', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const cb = makeTrackedCallbacks()

      // Stream que aborta após o primeiro chunk
      async function* abortingStream() {
        yield { choices: [{ delta: { content: 'Primeiro token' } }] }
        // Simula o AbortController sendo acionado durante a iteração
        agent.abort()
        // Lança o erro que o AbortController gera
        const err = new Error('The operation was aborted.')
        ;(err as unknown as Record<string, unknown>).name = 'AbortError'
        throw err
      }

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => abortingStream()),
          },
        },
      })

      // Act — não deve lançar erro
      await agent.run('hello', cb)

      // Assert
      expect(cb.doneCount).toBe(1)
      expect(cb.tokens[0]).toBe('Primeiro token')
    })
  })

  // ── 9. onDone sempre chamado no happy path ─────────────────────────────────
  describe('onDone', () => {
    it('should call onDone exactly once after a simple text stream', async () => {
      // Arrange
      const agent = new Agent()
      resolveReady(agent)

      const chunks = [
        { choices: [{ delta: { content: 'Resposta completa.' } }] },
      ]

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream(chunks)),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('hello', cb)

      // Assert
      expect(cb.doneCount).toBe(1)
    })
  })

  // ── OAuth: truncate multiple tool calls to single ───────────────────────────
  // [OAUTH-DISABLED] Skipped — OAuth feature temporarily disabled
  describe.skip('OAuth tool truncation', () => {
    it('should execute only the first tool call when provider is oauth and multiple tools are returned', async () => {
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_first', function: { name: 'read_file', arguments: JSON.stringify({ path: '/a.txt' }) } },
                { index: 1, id: 'call_second', function: { name: 'read_folder', arguments: JSON.stringify({ path: '/src' }) } },
                { index: 2, id: 'call_third', function: { name: 'grep', arguments: JSON.stringify({ pattern: 'foo' }) } },
              ],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', 'file content')
      const readFolderMock = makeToolMock('read_folder', 'folder listing')
      const grepMock = makeToolMock('grep', 'grep results')
      injectTool(agent, readFileMock)
      injectTool(agent, readFolderMock)
      injectTool(agent, grepMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: () => {
              callCount++
              if (callCount === 1) return makeStream(chunks)
              return makeStream([{ choices: [{ delta: { content: 'Done.' } }] }])
            },
          },
        },
      })

      const cb = makeTrackedCallbacks()

      await agent.run('read everything', cb)

      // Only the first tool should have been executed
      expect(readFileMock.execute).toHaveBeenCalledTimes(1)
      expect(readFolderMock.execute).not.toHaveBeenCalled()
      expect(grepMock.execute).not.toHaveBeenCalled()

      // onToolCall should only fire once
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_file')
    })

    it('should append skipped tools notification to tool result message', async () => {
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      // Wait for real initialization to complete (prevents race with messages reset)
      await (agent as any).readyPromise

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'read_file', arguments: JSON.stringify({ path: '/x.ts' }) } },
                { index: 1, id: 'call_b', function: { name: 'glob', arguments: JSON.stringify({ pattern: '*.ts' }) } },
              ],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', 'content of x.ts')
      const globMock = makeToolMock('glob', 'glob results')
      injectTool(agent, readFileMock)
      injectTool(agent, globMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: () => {
              callCount++
              if (callCount === 1) return makeStream(chunks)
              return makeStream([{ choices: [{ delta: { content: 'OK.' } }] }])
            },
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('find files', cb)

      // Check that the tool result contains the skipped notification
      const messages = (agent as any).messages
      const toolMsg = messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_a')
      expect(toolMsg).toBeDefined()
      expect(toolMsg.content).toContain('[System: You called 2 tools at once')
      expect(toolMsg.content).toContain('glob')
    })

    it('should NOT truncate when provider is not oauth', async () => {
      const agent = new Agent({ provider: 'deepseek', apiKey: 'test-key' })
      resolveReady(agent)

      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'read_file', arguments: JSON.stringify({ path: '/a.txt' }) } },
                { index: 1, id: 'call_2', function: { name: 'read_folder', arguments: JSON.stringify({ path: '/src' }) } },
              ],
            },
          }],
        },
      ]

      const readFileMock = makeToolMock('read_file', 'file a')
      const readFolderMock = makeToolMock('read_folder', 'folder src')
      injectTool(agent, readFileMock)
      injectTool(agent, readFolderMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: () => {
              callCount++
              if (callCount === 1) return makeStream(chunks)
              return makeStream([{ choices: [{ delta: { content: 'Both done.' } }] }])
            },
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('read both', cb)

      // Both tools should execute (parallel safe)
      expect(readFileMock.execute).toHaveBeenCalledTimes(1)
      expect(readFolderMock.execute).toHaveBeenCalledTimes(1)
      expect(cb.toolCalls).toHaveLength(2)
    })
  })
})
