import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = vi.fn(async () => ({
  modelSummaries: [
    { modelId: 'deepseek.deepseek-r1-v1:0' },
    { modelId: 'deepseek.deepseek-v3-0324:0' },
    { modelId: 'amazon.titan-text-express-v1:0' },        // deve ser filtrado
    { modelId: 'meta.llama3-8b-instruct-v1:0' },          // deve ser filtrado
    { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0' }, // deve ser filtrado
  ],
}))

vi.mock('@aws-sdk/client-bedrock', () => ({
  BedrockClient: class {
    send = mockSend
  },
  ListFoundationModelsCommand: class {},
}))

vi.mock('@aws-sdk/credential-providers', () => ({
  fromIni: () => ({}),
}))

// ── Importa DEPOIS dos mocks ───────────────────────────────────────────────
const { listBedrockDeepSeekModels } = await import('./bedrock.js')

// ── Testes ─────────────────────────────────────────────────────────────────

describe('listBedrockDeepSeekModels', () => {
  beforeEach(() => {
    mockSend.mockClear()
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
    mockSend.mockImplementationOnce(async () => ({ modelSummaries: undefined }))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })
})
