import { describe, it, expect, beforeEach, mock } from 'bun:test'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSend = mock(async (_command?: unknown, _options?: { abortSignal?: AbortSignal }) => ({
  modelSummaries: [
    { modelId: 'us.deepseek.r1-v1:0' },
    { modelId: 'deepseek.deepseek-v3-0324:0' },
    { modelId: 'amazon.titan-text-express-v1:0' },         // should be filtered
    { modelId: 'meta.llama3-8b-instruct-v1:0' },           // should be filtered
    { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0' }, // should be filtered
  ],
}))

mock.module('@aws-sdk/client-bedrock', () => ({
  BedrockClient: class {
    send = mockSend
  },
  ListFoundationModelsCommand: class {},
}))

// mock.module is process-wide: keep every export bedrock.ts imports, or later test files fail to link.
mock.module('@aws-sdk/credential-providers', () => ({
  fromIni: () => ({}),
  fromEnv: () => ({}),
}))

// ── Import AFTER the mocks ──────────────────────────────────────────────────
const { listBedrockDeepSeekModels } = await import('../src/agent/providers/bedrock.js')

// ── Tests ───────────────────────────────────────────────────────────────────

describe('listBedrockDeepSeekModels', () => {
  beforeEach(() => {
    // Ensure resolveCredentials always uses fromIni in tests.
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    delete process.env.AWS_SESSION_TOKEN

    mockSend.mockClear()
    // Restore the default implementation after each test.
    mockSend.mockImplementation(async () => ({
      modelSummaries: [
        { modelId: 'us.deepseek.r1-v1:0' },
        { modelId: 'deepseek.deepseek-v3-0324:0' },
        { modelId: 'amazon.titan-text-express-v1:0' },
        { modelId: 'meta.llama3-8b-instruct-v1:0' },
        { modelId: 'anthropic.claude-3-sonnet-20240229-v1:0' },
      ],
    }))
  })

  it('returns only models with "deepseek" in the ID', async () => {
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([
      'deepseek.deepseek-v3-0324:0',
      'us.deepseek.r1-v1:0',
    ])
  })

  it('returns a sorted list', async () => {
    mockSend.mockImplementationOnce(async () => ({
      modelSummaries: [
        { modelId: 'deepseek.deepseek-v3-0324:0' },
        { modelId: 'us.deepseek.r1-v1:0' },
      ],
    }))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([
      'deepseek.deepseek-v3-0324:0',
      'us.deepseek.r1-v1:0',
    ])
  })

  it('returns [] when the API fails', async () => {
    mockSend.mockImplementationOnce(async () => { throw new Error('AccessDeniedException') })
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })

  it('passes the optional abort signal to the cancellable SDK request', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    mockSend.mockImplementationOnce((_command, options) => new Promise((_, reject) => {
      receivedSignal = options?.abortSignal
      options?.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason), { once: true })
    }))

    const pending = listBedrockDeepSeekModels('us-east-1', 'default', controller.signal)
    await Bun.sleep(0)
    expect(receivedSignal).toBe(controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('returns [] when no DeepSeek models are available', async () => {
    mockSend.mockImplementationOnce(async () => ({
      modelSummaries: [
        { modelId: 'amazon.titan-text-express-v1:0' },
        { modelId: 'meta.llama3-8b-instruct-v1:0' },
      ],
    }))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })

  it('handles undefined modelSummaries', async () => {
    mockSend.mockImplementationOnce(async () => ({ modelSummaries: undefined } as any))
    const models = await listBedrockDeepSeekModels('us-east-1', 'default')
    expect(models).toEqual([])
  })
})
