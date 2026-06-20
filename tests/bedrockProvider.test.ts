import { describe, it, expect, beforeEach, mock } from 'bun:test'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = mock(async () => ({
  modelSummaries: [
    { modelId: 'deepseek.deepseek-r1-v1:0' },
    { modelId: 'deepseek.deepseek-v3-0324:0' },
    { modelId: 'amazon.titan-text-express-v1:0' },         // deve ser filtrado
    { modelId: 'meta.llama3-8b-instruct-v1:0' },           // deve ser filtrado
    { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0' }, // deve ser filtrado
  ],
}))

mock.module('@aws-sdk/client-bedrock', () => ({
  BedrockClient: class {
    send = mockSend
  },
  ListFoundationModelsCommand: class {},
}))

mock.module('@aws-sdk/credential-providers', () => ({
  fromIni: () => ({}),
}))

// ── Importa DEPOIS dos mocks ───────────────────────────────────────────────
const { listBedrockDeepSeekModels } = await import('../src/agent/providers/bedrock.js')

// ── Testes ─────────────────────────────────────────────────────────────────

describe('listBedrockDeepSeekModels', () => {
  beforeEach(() => {
    mockSend.mockClear()
    // Restaura implementação padrão após cada teste
    mockSend.mockImplementation(async () => ({
      modelSummaries: [
        { modelId: 'deepseek.deepseek-r1-v1:0' },
        { modelId: 'deepseek.deepseek-v3-0324:0' },
        { modelId: 'amazon.titan-text-express-v1:0' },
        { modelId: 'meta.llama3-8b-instruct-v1:0' },
        { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0' },
      ],
    }))
  })

  it('retorna apenas modelos com "deepseek" no ID', async () => {
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([
      'deepseek.deepseek-r1-v1:0',
      'deepseek.deepseek-v3-0324:0',
    ])
  })

  it('retorna lista ordenada', async () => {
    mockSend.mockImplementationOnce(async () => ({
      modelSummaries: [
        { modelId: 'deepseek.deepseek-v3-0324:0' },
        { modelId: 'deepseek.deepseek-r1-v1:0' },
      ],
    }))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([
      'deepseek.deepseek-r1-v1:0',
      'deepseek.deepseek-v3-0324:0',
    ])
  })

  it('retorna [] quando a API falha', async () => {
    mockSend.mockImplementationOnce(async () => { throw new Error('AccessDeniedException') })
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })

  it('retorna [] quando não há modelos DeepSeek disponíveis', async () => {
    mockSend.mockImplementationOnce(async () => ({
      modelSummaries: [
        { modelId: 'amazon.titan-text-express-v1:0' },
        { modelId: 'meta.llama3-8b-instruct-v1:0' },
      ],
    }))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })

  it('lida com modelSummaries undefined', async () => {
    mockSend.mockImplementationOnce(async () => ({ modelSummaries: undefined } as any))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })
})
