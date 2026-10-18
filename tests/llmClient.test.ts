import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createLLMClient, defaultModel } from '../src/agent/llmClient.js'

let previousDeepSeekBaseUrl: string | undefined

beforeEach(() => {
  previousDeepSeekBaseUrl = process.env.DEEPSEEK_BASE_URL
  delete process.env.DEEPSEEK_BASE_URL
})

afterEach(() => {
  if (previousDeepSeekBaseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL
  else process.env.DEEPSEEK_BASE_URL = previousDeepSeekBaseUrl
})

describe('createLLMClient', () => {
  it('deepseek provider returns a client with the correct baseURL', () => {
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key' })
    expect(client).toBeDefined()
    expect((client as any).baseURL).toBe('https://api.deepseek.com')
  })

  it('deepseek provider uses the custom baseURL from cfg', () => {
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key', baseURL: 'https://success.ai/v1' })
    expect((client as any).baseURL).toBe('https://success.ai/v1')
  })

  it('deepseek provider uses the DEEPSEEK_BASE_URL environment value when cfg.baseURL is unset', () => {
    process.env.DEEPSEEK_BASE_URL = 'https://proxy.example.com/v1'
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key' })
    expect((client as any).baseURL).toBe('https://proxy.example.com/v1')
  })

  it('deepseek provider gives cfg.baseURL priority over the DEEPSEEK_BASE_URL environment value', () => {
    process.env.DEEPSEEK_BASE_URL = 'https://env.example.com/v1'
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key', baseURL: 'https://cfg.example.com/v1' })
    expect((client as any).baseURL).toBe('https://cfg.example.com/v1')
  })

  it('bedrock provider uses the us-east-1 default region', () => {
    const client = createLLMClient({ provider: 'bedrock' })
    expect((client as any).baseURL).toContain('us-east-1')
    expect((client as any).baseURL).toContain('bedrock-runtime')
  })

  it('bedrock provider uses a custom region', () => {
    const client = createLLMClient({ provider: 'bedrock', awsRegion: 'eu-west-1' })
    expect((client as any).baseURL).toContain('eu-west-1')
  })

  it('vertex provider uses the AI Platform URL', () => {
    const client = createLLMClient({ provider: 'vertex', gcpProject: 'my-project', gcpLocation: 'us-central1', gcpCredentials: '/tmp/sa.json' })
    expect((client as any).baseURL).toContain('aiplatform.googleapis.com')
    expect((client as any).baseURL).toContain('my-project')
  })

  it('vertex provider throws when gcpCredentials are missing', () => {
    expect(() => createLLMClient({ provider: 'vertex', gcpProject: 'my-project' })).toThrow('GCP_CREDENTIALS')
  })

  it('local provider adds http:// when the URL has no scheme', () => {
    const client = createLLMClient({ provider: 'local', localBaseUrl: 'localhost:11434/v1' })
    expect((client as any).baseURL).toMatch(/^http:\/\//)
  })

  it('local provider preserves an explicit URL scheme', () => {
    const client = createLLMClient({ provider: 'local', localBaseUrl: 'http://localhost:11434/v1' })
    expect((client as any).baseURL).toBe('http://localhost:11434/v1')
  })

  it('local provider preserves HTTPS', () => {
    const client = createLLMClient({ provider: 'local', localBaseUrl: 'https://my-server.com/v1' })
    expect((client as any).baseURL).toBe('https://my-server.com/v1')
  })
})

describe('defaultModel', () => {
  it('deepseek defaults to deepseek-flash', () => {
    expect(defaultModel('deepseek')).toBe('deepseek-flash')
  })

  it('bedrock defaults to the DeepSeek model', () => {
    expect(defaultModel('bedrock')).toBe('us.deepseek.r1-v1:0')
  })

  it('vertex defaults to the DeepSeek model', () => {
    expect(defaultModel('vertex')).toBe('deepseek-ai/deepseek-r1')
  })

  it('local defaults to llama3', () => {
    expect(defaultModel('local')).toBe('llama3')
  })
})
