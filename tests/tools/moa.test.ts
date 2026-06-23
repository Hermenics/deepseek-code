import { describe, it, expect, mock, beforeEach, afterEach, beforeAll } from 'bun:test'
import type { MoAConfig, MoALayerResult, MoAResult, MoAReferenceModel } from '../../src/tools/MoA/types.js'

// ---------------------------------------------------------------------------
// Mocks de módulo — devem vir antes dos imports do código-alvo
// ---------------------------------------------------------------------------

const mockChatCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: 'mock response text' } }],
    usage: { total_tokens: 42, prompt_tokens: 20, completion_tokens: 22 },
    model: 'mock-model',
  })
)

mock.module('../../src/agent/llmClient.js', () => ({
  createLLMClient: mock(() => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
  })),
  defaultModel: 'deepseek-v4-flash',
}))

// Importações do código-alvo (não existem ainda — fase RED)
import { callReferenceModel, executeMoA } from '../../src/tools/MoA/executor.js'
import { MoATool } from '../../src/tools/MoA/MoA.js'

// ---------------------------------------------------------------------------
// Dados de apoio reutilizáveis
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key-for-unit-tests'
})

function makeConfig(overrides: Partial<MoAConfig> = {}): MoAConfig {
  return {
    referenceModels: [
      { model: 'deepseek-v4-flash', weight: 1 },
      { model: 'deepseek-r2', weight: 1 },
      { model: 'deepseek-coder-v3', weight: 1 },
    ],
    aggregator: { model: 'deepseek-v4-flash', temperature: 0.4 },
    minResponses: 1,
    timeoutMs: 60000,
    maxRetries: 1,
    ...overrides,
  }
}

function makeLayerResult(overrides: Partial<MoALayerResult> = {}): MoALayerResult {
  return {
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    response: 'mock response text',
    tokens: 42,
    costUsd: 0.001,
    durationMs: 100,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Grupo 1: executor.ts — callReferenceModel
// ---------------------------------------------------------------------------

describe('callReferenceModel', () => {
  beforeEach(() => {
    mockChatCreate.mockClear()
  })

  it('should return MoALayerResult with response, tokens and costUsd when API succeeds', async () => {
    const ref: MoAReferenceModel = { model: 'deepseek-v4-flash' }

    const result = await callReferenceModel(ref, 'What is 2+2?', undefined, 30000)

    expect(result).toMatchObject({
      model: 'deepseek-v4-flash',
      response: expect.any(String),
      tokens: expect.any(Number),
      costUsd: expect.any(Number),
      durationMs: expect.any(Number),
    })
    expect(result.response).not.toBeNull()
    expect(result.tokens).toBeGreaterThanOrEqual(0)
    expect(result.costUsd).toBeGreaterThanOrEqual(0)
  })

  it('should abort the request and set error when model exceeds timeout', async () => {
    // Simula modelo lento: create nunca resolve dentro do timeout
    mockChatCreate.mockImplementationOnce(
      ((_args: unknown, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
          }
        })) as unknown as typeof mockChatCreate
    )

    const ref: MoAReferenceModel = { model: 'deepseek-v4-flash' }
    const result = await callReferenceModel(ref, 'slow prompt', undefined, 1) // 1ms timeout

    expect(result.response).toBeNull()
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/timeout|abort/i)
  })

  it('should return response=null and populate error when API throws', async () => {
    mockChatCreate.mockImplementationOnce(() => Promise.reject(new Error('Network error: connection refused')))

    const ref: MoAReferenceModel = { model: 'deepseek-v4-flash' }
    const result = await callReferenceModel(ref, 'some prompt', undefined, 30000)

    expect(result.response).toBeNull()
    expect(typeof result.error).toBe('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })

  it('should use provider override when referenceModel has a provider config', async () => {
    const ref: MoAReferenceModel = {
      model: 'claude-3-sonnet',
      provider: { provider: 'bedrock', awsRegion: 'us-west-2' },
    }

    const result = await callReferenceModel(ref, 'test prompt', undefined, 30000)

    // Provider 'bedrock' deve aparecer no resultado
    expect(result.provider).toBe('bedrock')
    expect(result.model).toBe('claude-3-sonnet')
  })
})

// ---------------------------------------------------------------------------
// Grupo 2: executor.ts — executeMoA happy path
// ---------------------------------------------------------------------------

describe('executeMoA — happy path', () => {
  beforeEach(() => {
    mockChatCreate.mockClear()
    // Resposta padrão: 3 references + 1 aggregator = 4 chamadas
    mockChatCreate.mockImplementation(() =>
      Promise.resolve({
        choices: [{ message: { content: 'Synthesized answer' } }],
        usage: { total_tokens: 50, prompt_tokens: 25, completion_tokens: 25 },
        model: 'mock-model',
      })
    )
  })

  it('should return a complete MoAResult when all 3 references respond', async () => {
    const config = makeConfig()
    const result = await executeMoA('Explain recursion', undefined, config)

    expect(result).toMatchObject({
      synthesis: expect.any(String),
      references: expect.any(Array),
      aggregator: expect.any(Object),
      totalTokens: expect.any(Number),
      totalCostUsd: expect.any(Number),
      totalDurationMs: expect.any(Number),
    })
    expect(result.references).toHaveLength(3)
    expect(result.synthesis.length).toBeGreaterThan(0)
  })

  it('should set totalTokens as the sum of all reference tokens plus aggregator tokens', async () => {
    const config = makeConfig()
    const result = await executeMoA('Sum test prompt', undefined, config)

    const refTokensSum = result.references.reduce((acc, r) => acc + r.tokens, 0)
    expect(result.totalTokens).toBe(refTokensSum + result.aggregator.tokens)
  })

  it('should set totalCostUsd as the sum of all reference costs plus aggregator cost', async () => {
    const config = makeConfig()
    const result = await executeMoA('Cost test prompt', undefined, config)

    const refCostSum = result.references.reduce((acc, r) => acc + r.costUsd, 0)
    const expected = parseFloat((refCostSum + result.aggregator.costUsd).toFixed(10))
    expect(parseFloat(result.totalCostUsd.toFixed(10))).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Grupo 3: executor.ts — executeMoA falhas parciais
// ---------------------------------------------------------------------------

describe('executeMoA — partial failures', () => {
  beforeEach(() => {
    mockChatCreate.mockClear()
  })

  it('should succeed when 1 reference fails and 2 respond (minResponses=1)', async () => {
    let callCount = 0
    mockChatCreate.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.reject(new Error('Model overloaded'))
      }
      return Promise.resolve({
        choices: [{ message: { content: 'Partial answer' } }],
        usage: { total_tokens: 30, prompt_tokens: 15, completion_tokens: 15 },
        model: 'mock-model',
      })
    })

    const config = makeConfig({ minResponses: 1 })
    const result = await executeMoA('Test partial failure', undefined, config)

    // Aggregator deve ter recebido apenas as 2 respostas válidas
    const successfulRefs = result.references.filter(r => r.response !== null)
    expect(successfulRefs.length).toBeGreaterThanOrEqual(1)
    expect(result.synthesis).toBeDefined()
  })

  it('should throw a descriptive error when all reference models fail', async () => {
    mockChatCreate.mockImplementation(() => Promise.reject(new Error('Service unavailable')))

    const config = makeConfig({ minResponses: 1 })

    await expect(executeMoA('All fail prompt', undefined, config)).rejects.toThrow()
  })

  it('should throw with count info when successful responses are below minResponses', async () => {
    let callCount = 0
    mockChatCreate.mockImplementation(() => {
      callCount++
      // Só o aggregator (4ª chamada) teria sucesso, mas as 3 references falham
      return Promise.reject(new Error('Rate limited'))
    })

    const config = makeConfig({ minResponses: 2 }) // exige pelo menos 2

    let caughtError: Error | undefined
    try {
      await executeMoA('Below minResponses', undefined, config)
    } catch (e) {
      caughtError = e as Error
    }

    expect(caughtError).toBeDefined()
    // A mensagem deve conter alguma indicação de contagem ou mínimo
    expect(caughtError!.message).toMatch(/\d|minimum|min|required/i)
  })
})

// ---------------------------------------------------------------------------
// Grupo 4: executor.ts — aggregator
// ---------------------------------------------------------------------------

describe('executeMoA — aggregator behavior', () => {
  beforeEach(() => {
    mockChatCreate.mockClear()
  })

  it('should include reference responses in the aggregator system prompt', async () => {
    const capturedArgs: unknown[] = []
    mockChatCreate.mockImplementation(((args: unknown) => {
      capturedArgs.push(args)
      return Promise.resolve({
        choices: [{ message: { content: 'Aggregated result' } }],
        usage: { total_tokens: 60, prompt_tokens: 30, completion_tokens: 30 },
        model: 'mock-model',
      })
    }) as unknown as typeof mockChatCreate)

    const config = makeConfig()
    await executeMoA('Test aggregator receives refs', undefined, config)

    // A última chamada é do aggregator — seu system prompt deve conter respostas das references
    const lastCall = capturedArgs[capturedArgs.length - 1] as { messages: Array<{ role: string; content: string }> }
    const systemMsg = lastCall.messages?.find((m: { role: string }) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.content).toMatch(/model|response|reference|1\.|answer/i)
  })

  it('should fall back to the best reference response when aggregator fails', async () => {
    let callCount = 0
    mockChatCreate.mockImplementation(() => {
      callCount++
      if (callCount <= 3) {
        // 3 references succedem
        return Promise.resolve({
          choices: [{ message: { content: `Reference answer ${callCount}` } }],
          usage: { total_tokens: 40, prompt_tokens: 20, completion_tokens: 20 },
          model: 'mock-model',
        })
      }
      // Aggregator (4ª chamada) falha
      return Promise.reject(new Error('Aggregator unavailable'))
    })

    const config = makeConfig()
    const result = await executeMoA('Aggregator failure test', undefined, config)

    // O synthesis deve vir de uma das references
    expect(result.synthesis).toMatch(/Reference answer/)
    // aggregator deve ter error setado
    expect(result.aggregator.error).toBeDefined()
    expect(result.aggregator.response).toBeNull()
  })

  it('should call aggregator with temperature from config (0.4)', async () => {
    const capturedArgs: unknown[] = []
    mockChatCreate.mockImplementation(((args: unknown) => {
      capturedArgs.push(args)
      return Promise.resolve({
        choices: [{ message: { content: 'Response' } }],
        usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 },
        model: 'mock-model',
      })
    }) as unknown as typeof mockChatCreate)

    const config = makeConfig({ aggregator: { model: 'deepseek-v4-flash', temperature: 0.4 } })
    await executeMoA('Temperature test', undefined, config)

    // Última chamada = aggregator
    const lastCall = capturedArgs[capturedArgs.length - 1] as { temperature?: number }
    expect(lastCall.temperature).toBe(0.4)
  })
})

// ---------------------------------------------------------------------------
// Grupo 5: MoA.ts — tool integration
// ---------------------------------------------------------------------------

describe('MoATool — tool integration', () => {
  it('should be registered with name "moa"', () => {
    expect(MoATool.name).toBe('moa')
  })

  it('should have a non-empty description', () => {
    expect(typeof MoATool.description).toBe('string')
    expect(MoATool.description.length).toBeGreaterThan(10)
  })

  it('should have parameters with required field "prompt"', () => {
    const params = MoATool.parameters as {
      type: string
      properties: Record<string, unknown>
      required: string[]
    }
    expect(params.type).toBe('object')
    expect(params.properties).toHaveProperty('prompt')
    expect(params.required).toContain('prompt')
  })

  it('should have optional parameters: systemPrompt, referenceModels, aggregatorModel', () => {
    const params = MoATool.parameters as {
      properties: Record<string, unknown>
    }
    expect(params.properties).toHaveProperty('systemPrompt')
    expect(params.properties).toHaveProperty('referenceModels')
    expect(params.properties).toHaveProperty('aggregatorModel')
  })

  it('should resolve config: args override takes precedence over defaults', async () => {
    mockChatCreate.mockImplementation(() =>
      Promise.resolve({
        choices: [{ message: { content: 'Result' } }],
        usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
        model: 'mock-model',
      })
    )

    // Passa aggregatorModel como override
    const result = await MoATool.execute({
      prompt: 'Config override test',
      aggregatorModel: 'deepseek-r2',
    })

    // Deve retornar uma string com o resultado da síntese
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should call executeMoA and return formatted result as string', async () => {
    mockChatCreate.mockImplementation(() =>
      Promise.resolve({
        choices: [{ message: { content: 'Final synthesis here' } }],
        usage: { total_tokens: 30, prompt_tokens: 15, completion_tokens: 15 },
        model: 'mock-model',
      })
    )

    const result = await MoATool.execute({ prompt: 'What is the meaning of life?' })

    expect(typeof result).toBe('string')
    expect(result).toContain('Final synthesis here')
  })
})

// ---------------------------------------------------------------------------
// Grupo 6: callbacks
// ---------------------------------------------------------------------------

describe('executeMoA — callbacks', () => {
  beforeEach(() => {
    mockChatCreate.mockClear()
    mockChatCreate.mockImplementation(() =>
      Promise.resolve({
        choices: [{ message: { content: 'CB response' } }],
        usage: { total_tokens: 20, prompt_tokens: 10, completion_tokens: 10 },
        model: 'mock-model',
      })
    )
  })

  it('should call onStart with an id and descriptive task string', async () => {
    const onStart = mock((_id: string, _task: string) => {})
    const config = makeConfig()

    await executeMoA('Callback start test', undefined, config, { onStart })

    expect(onStart).toHaveBeenCalledTimes(1)
    const [id, task] = onStart.mock.calls[0] as [string, string]
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(typeof task).toBe('string')
    expect(task.length).toBeGreaterThan(0)
  })

  it('should call onToolUse for each reference model that responds successfully', async () => {
    const onToolUse = mock((_layerResult: MoALayerResult) => {})
    const config = makeConfig() // 3 references

    await executeMoA('Callback tooluse test', undefined, config, { onToolUse })

    // Deve ter sido chamado pelo menos 1 vez (todas responderam com sucesso)
    expect(onToolUse.mock.calls.length).toBeGreaterThanOrEqual(1)
    // Cada chamada recebe um MoALayerResult
    for (const [layerResult] of onToolUse.mock.calls as [[MoALayerResult]]) {
      expect(layerResult).toMatchObject({
        model: expect.any(String),
        tokens: expect.any(Number),
        costUsd: expect.any(Number),
      })
    }
  })

  it('should call onDone with totalTokens and totalCostUsd when execution completes', async () => {
    const onDone = mock((_tokens: number, _cost: number) => {})
    const config = makeConfig()

    await executeMoA('Callback done test', undefined, config, { onDone })

    expect(onDone).toHaveBeenCalledTimes(1)
    const [tokens, cost] = onDone.mock.calls[0] as [number, number]
    expect(typeof tokens).toBe('number')
    expect(tokens).toBeGreaterThanOrEqual(0)
    expect(typeof cost).toBe('number')
    expect(cost).toBeGreaterThanOrEqual(0)
  })
})
