import { describe, it, expect, mock } from 'bun:test'
import { Agent } from '../src/agent/agent.js'
import type { AgentCallbacks } from '../src/agent/agent.js'
import type { ProviderConfig } from '../src/ui/setup/ApiKeySetup.js'
import { parseToolResponse } from '../src/agent/providers/proxy/tools/prompt-emulation.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mesmo padrão de streaming.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

function injectMockClient(agent: Agent, clientMock: object) {
  ;(agent as unknown as Record<string, unknown>).client = clientMock
}

function resolveReady(agent: Agent) {
  // Wait for the real initialize() to finish, then prevent re-runs
  const original = (agent as unknown as Record<string, unknown>).readyPromise as Promise<void>
  ;(agent as unknown as Record<string, unknown>).readyPromise = original.catch(() => {})
}

async function* makeStream(chunks: object[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

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

function makeToolMock(name: string, result: string, params?: Record<string, any>) {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {
      type: 'object',
      properties: params ?? { path: { type: 'string', description: 'Path to read' } },
    },
    execute: mock(() => Promise.resolve(result)),
  }
}

function injectTool(agent: Agent, tool: ReturnType<typeof makeToolMock>) {
  const toolMap = (agent as unknown as Record<string, unknown>).toolMap as Map<string, unknown>
  toolMap.set(tool.name, tool)
}

// ─────────────────────────────────────────────────────────────────────────────
// Cenário 1: Agent fallback — proxy entrega tool_use como delta.content
//
// Quando provider='oauth' e o streaming retorna delta.content com JSON
// {"tool_use": ...}, o Agent deve detectar, executar a tool e continuar o loop
// em vez de tratar como resposta final.
// ─────────────────────────────────────────────────────────────────────────────

// [OAUTH-DISABLED] Skipped — OAuth feature temporarily disabled
describe.skip('OAuth tool fallback — Agent', () => {

  describe('Cenário 1: delta.content contém JSON tool_use limpo', () => {
    it('should detect tool call in delta.content, execute the tool, and not call onDone prematurely', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: '.' } } })

      // Primeira iteração: proxy entrega tool_use como texto em delta.content (sem delta.tool_calls)
      const firstStream = [
        { choices: [{ delta: { content: toolJson } }] },
      ]

      // Segunda iteração: resposta final após execução da tool
      const secondStream = [
        { choices: [{ delta: { content: 'Aqui estão os arquivos.' } }] },
      ]

      const readFolderMock = makeToolMock('read_folder', 'src/\ntests/')
      injectTool(agent, readFolderMock)

      let callCount = 0
      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => {
              callCount++
              if (callCount === 1) return makeStream(firstStream)
              return makeStream(secondStream)
            }),
          },
        },
      })

      const cb = makeTrackedCallbacks()

      // Act
      await agent.run('liste os arquivos', cb)

      // Assert — a tool deve ter sido executada (não tratado como texto final)
      expect(readFolderMock.execute).toHaveBeenCalledTimes(1)
      expect(readFolderMock.execute).toHaveBeenCalledWith({ path: '.' })

      // onToolCall deve ter disparado
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_folder')

      // onToolResult deve ter disparado com o resultado correto
      expect(cb.toolResults).toHaveLength(1)
      expect(cb.toolResults[0]!.result).toBe('src/\ntests/')

      // onDone deve ter sido chamado exatamente uma vez (ao final)
      expect(cb.doneCount).toBe(1)

      // O cliente deve ter sido chamado duas vezes (loop continuou)
      expect(callCount).toBe(2)
    })

    it('should add tool result to message history before continuing the loop', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: 'src' } } })

      let callCount = 0
      const readFolderMock = makeToolMock('read_folder', 'agent.ts\ntools.ts')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => {
              callCount++
              if (callCount === 1) return makeStream([{ choices: [{ delta: { content: toolJson } }] }])
              return makeStream([{ choices: [{ delta: { content: 'Pronto.' } }] }])
            }),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('veja src', cb)

      // Assert — histórico deve conter a mensagem de resultado da tool
      const messages = (agent as any).messages
      const hasToolResult = messages.some(
        (m: any) => (m.role === 'tool' || m.role === 'user') &&
          typeof m.content === 'string' &&
          m.content.includes('agent.ts')
      )
      expect(hasToolResult).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Cenário 2: JSON com prefixo de texto curto (< 200 chars)
  //
  // O modelo às vezes responde: "Vou verificar.\n{"tool_use": ...}"
  // O Agent deve detectar e executar a tool mesmo com texto antes.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Cenário 2: delta.content com prefixo de texto curto antes do JSON', () => {
    it('should detect and execute tool when short text precedes the JSON (< 200 chars)', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: '.' } } })
      const contentWithPrefix = `Vou verificar.\n${toolJson}`

      // Confirma que parseToolResponse aceita esse formato (< 200 chars de prefixo)
      const parsed = parseToolResponse(contentWithPrefix)
      expect(parsed).not.toBeNull() // pré-condição: o parser já suporta isso

      let callCount = 0
      const readFolderMock = makeToolMock('read_folder', 'lista de arquivos')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => {
              callCount++
              if (callCount === 1) return makeStream([{ choices: [{ delta: { content: contentWithPrefix } }] }])
              return makeStream([{ choices: [{ delta: { content: 'Feito.' } }] }])
            }),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('liste arquivos', cb)

      // Assert — tool deve ter sido executada apesar do prefixo
      expect(readFolderMock.execute).toHaveBeenCalledTimes(1)
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_folder')
      expect(cb.doneCount).toBe(1)
      expect(callCount).toBe(2)
    })

    it('should NOT execute tool when text prefix is longer than 500 chars', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      // Prefixo longo (> 500 chars) — modelo está explicando, não chamando tool
      const longPrefix = 'A '.repeat(260) // 520 chars
      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: '.' } } })
      const contentWithLongPrefix = `${longPrefix}${toolJson}`

      // Confirma que parseToolResponse rejeita esse formato
      const parsed = parseToolResponse(contentWithLongPrefix)
      expect(parsed).toBeNull() // pré-condição: o parser rejeita prefixo longo

      const readFolderMock = makeToolMock('read_folder', 'lista')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream([{ choices: [{ delta: { content: contentWithLongPrefix } }] }])),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('explique e liste', cb)

      // Assert — NÃO deve executar tool (é explicação com exemplo de JSON)
      expect(readFolderMock.execute).not.toHaveBeenCalled()
      expect(cb.toolCalls).toHaveLength(0)
      // onDone deve ter sido chamado (tratou como resposta final)
      expect(cb.doneCount).toBe(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Cenário 3: JSON com backticks (proxy falhou ao limpar)
  //
  // Se o texto vier como: ```json\n{"tool_use": ...}\n```
  // O Agent deve limpar os backticks e parsear.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Cenário 3: delta.content com backticks (proxy não limpou)', () => {
    it('should detect and execute tool when JSON is wrapped in ```json code fence', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: '.' } } })
      const contentWithFence = `\`\`\`json\n${toolJson}\n\`\`\``

      // parseToolResponse agora aceita code fences (fix aplicado)
      const parsed = parseToolResponse(contentWithFence)
      expect(parsed).not.toBeNull() // pré-condição: parser aceita backticks após fix

      let callCount = 0
      const readFolderMock = makeToolMock('read_folder', 'src/')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => {
              callCount++
              if (callCount === 1) return makeStream([{ choices: [{ delta: { content: contentWithFence } }] }])
              return makeStream([{ choices: [{ delta: { content: 'Pronto.' } }] }])
            }),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('liste arquivos', cb)

      // Assert — Agent deve ter limpado os backticks e executado a tool
      expect(readFolderMock.execute).toHaveBeenCalledTimes(1)
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.toolCalls[0]!.name).toBe('read_folder')
      expect(cb.doneCount).toBe(1)
      expect(callCount).toBe(2)
    })

    it('should detect and execute tool when JSON is wrapped in plain ``` code fence', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: 'src' } } })
      const contentWithFence = `\`\`\`\n${toolJson}\n\`\`\``

      // parseToolResponse agora aceita code fences (fix aplicado)
      expect(parseToolResponse(contentWithFence)).not.toBeNull()

      let callCount = 0
      const readFolderMock = makeToolMock('read_folder', 'agent.ts')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => {
              callCount++
              if (callCount === 1) return makeStream([{ choices: [{ delta: { content: contentWithFence } }] }])
              return makeStream([{ choices: [{ delta: { content: 'OK.' } }] }])
            }),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('veja src', cb)

      // Assert — Agent deve ter limpado os backticks e executado a tool
      expect(readFolderMock.execute).toHaveBeenCalledTimes(1)
      expect(cb.toolCalls).toHaveLength(1)
      expect(cb.doneCount).toBe(1)
      expect(callCount).toBe(2)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Cenário 5: Agent NÃO deve parsear como tool se texto é longo (> 500 chars)
  //
  // Se o modelo responde com uma explicação longa seguida de JSON,
  // NÃO é tool call — é o modelo mostrando um exemplo.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Cenário 5: texto longo antes do JSON não é tool call', () => {
    it('should treat response as final text when long explanation precedes JSON example', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      // Explicação longa (> 500 chars) seguida de JSON de exemplo
      const longExplanation = 'Para listar arquivos você pode usar a ferramenta read_folder. O formato correto é o seguinte JSON que você deve usar quando quiser listar um diretório específico do projeto. Certifique-se de passar o caminho correto como argumento path. Essa ferramenta aceita um parâmetro opcional recursive que permite listar subdiretórios também. Veja abaixo o exemplo completo de como chamar essa ferramenta no formato JSON esperado pelo sistema de tools do DeepSeek Code. Lembre-se de que o JSON deve ser enviado sem nenhum texto adicional antes ou depois dele para funcionar corretamente no sistema: '
      // longExplanation.length > 500
      const toolJson = JSON.stringify({ tool_use: { name: 'read_folder', arguments: { path: '.' } } })
      const fullContent = `${longExplanation}${toolJson}`

      expect(fullContent.indexOf('{"tool_use"')).toBeGreaterThan(500) // pré-condição

      const readFolderMock = makeToolMock('read_folder', 'lista')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream([{ choices: [{ delta: { content: fullContent } }] }])),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('como listar arquivos?', cb)

      // Assert — NÃO deve executar tool (é explicação com exemplo)
      expect(readFolderMock.execute).not.toHaveBeenCalled()
      expect(cb.toolCalls).toHaveLength(0)

      // Deve ter tratado como resposta final
      expect(cb.doneCount).toBe(1)

      // O texto completo deve ter sido emitido como token
      const allTokens = cb.tokens.join('')
      expect(allTokens).toContain(longExplanation)
    })

    it('should treat response as final text when JSON appears inside a code fence in explanation', async () => {
      // Arrange
      // [OAUTH-DISABLED] cast needed because 'oauth' was removed from ProviderName
      const agent = new Agent({ provider: 'oauth', proxyApiKey: 'test-proxy-key' } as unknown as ProviderConfig)
      resolveReady(agent)

      // Modelo mostrando exemplo com code fence — nunca deve executar
      const content = 'Aqui está um exemplo de como chamar a tool:\n\n```json\n{"tool_use": {"name": "read_folder", "arguments": {"path": "."}}}\n```\n\nUse esse formato quando precisar listar arquivos.'

      const readFolderMock = makeToolMock('read_folder', 'lista')
      injectTool(agent, readFolderMock)

      injectMockClient(agent, {
        chat: {
          completions: {
            create: mock(() => makeStream([{ choices: [{ delta: { content } }] }])),
          },
        },
      })

      const cb = makeTrackedCallbacks()
      await agent.run('como usar a tool?', cb)

      // Assert — NÃO deve executar tool
      expect(readFolderMock.execute).not.toHaveBeenCalled()
      expect(cb.toolCalls).toHaveLength(0)
      expect(cb.doneCount).toBe(1)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cenário 4: parseToolResponse — strip de code fences
//
// O parseToolResponse em tool-emulation.ts hoje rejeita texto que começa com ```.
// Estes testes documentam o comportamento atual (retorna null) e definem o
// contrato esperado após a correção: deve parsear após strip dos backticks.
// ─────────────────────────────────────────────────────────────────────────────

// [OAUTH-DISABLED] Skipped — OAuth feature temporarily disabled
describe.skip('parseToolResponse — strip de code fences (Cenário 4)', () => {

  describe('comportamento corrigido (code fences são aceitos)', () => {
    it('should parse tool_use inside ```json fence', () => {
      const input = '```json\n{"tool_use": {"name": "read_folder", "arguments": {"path": "."}}}\n```'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_folder')
      expect(result!.arguments).toEqual({ path: '.' })
    })

    it('should parse tool_use inside plain ``` fence', () => {
      const input = '```\n{"tool_use": {"name": "shell", "arguments": {"command": "ls"}}}\n```'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
      expect(result!.arguments).toEqual({ command: 'ls' })
    })
  })

  describe('contrato esperado após correção', () => {
    it('should parse tool_use after stripping ```json code fence', () => {
      const inner = '{"tool_use": {"name": "read_folder", "arguments": {"path": "."}}}'
      const input = `\`\`\`json\n${inner}\n\`\`\``

      // CONTRATO: após strip de code fences, deve parsear corretamente
      // Esta função auxiliar simula o que o Agent (ou parseToolResponse corrigido) deve fazer
      const stripped = input.replace(/^```(?:json|typescript|text|js)?\n?/, '').replace(/\n?```$/, '').trim()
      const result = parseToolResponse(stripped)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_folder')
      expect(result!.arguments).toEqual({ path: '.' })
      expect(result!.id).toMatch(/^toolu_/)
    })

    it('should parse tool_use after stripping plain ``` code fence', () => {
      const inner = '{"tool_use": {"name": "shell", "arguments": {"command": "bun test"}}}'
      const input = `\`\`\`\n${inner}\n\`\`\``

      const stripped = input.replace(/^```(?:json|typescript|text|js)?\n?/, '').replace(/\n?```$/, '').trim()
      const result = parseToolResponse(stripped)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
      expect(result!.arguments).toEqual({ command: 'bun test' })
    })

    it('should parse tool_use after stripping ```text code fence', () => {
      const inner = '{"tool_use": {"name": "grep", "arguments": {"pattern": "TODO", "path": "src"}}}'
      const input = `\`\`\`text\n${inner}\n\`\`\``

      const stripped = input.replace(/^```(?:json|typescript|text|js)?\n?/, '').replace(/\n?```$/, '').trim()
      const result = parseToolResponse(stripped)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('grep')
      expect(result!.arguments).toEqual({ pattern: 'TODO', path: 'src' })
    })

    it('should return null when code fence contains non-tool JSON (not a false positive)', () => {
      const inner = '{"name": "John", "age": 30}'
      const input = `\`\`\`json\n${inner}\n\`\`\``

      const stripped = input.replace(/^```(?:json|typescript|text|js)?\n?/, '').replace(/\n?```$/, '').trim()
      const result = parseToolResponse(stripped)

      // Não é tool call — deve retornar null mesmo após strip
      expect(result).toBeNull()
    })

    it('should return null when code fence contains code (not JSON tool call)', () => {
      const input = '```typescript\nconst x = readFolder(".")\nconsole.log(x)\n```'

      const stripped = input.replace(/^```(?:json|typescript|text|js)?\n?/, '').replace(/\n?```$/, '').trim()
      const result = parseToolResponse(stripped)

      expect(result).toBeNull()
    })
  })
})
