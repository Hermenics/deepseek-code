import { describe, it, expect } from 'bun:test'
import { createLLMClient, defaultModel } from '../src/agent/llmClient.js'

describe('createLLMClient', () => {
  it('deepseek provider retorna cliente com baseURL correta', () => {
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key' })
    expect(client).toBeDefined()
    expect((client as any).baseURL).toBe('https://api.deepseek.com')
  })

  it('deepseek provider usa baseURL customizada do cfg', () => {
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key', baseURL: 'https://success.ai/v1' })
    expect((client as any).baseURL).toBe('https://success.ai/v1')
  })

  it('deepseek provider usa DEEPSEEK_BASE_URL do env quando cfg.baseURL não definido', () => {
    process.env.DEEPSEEK_BASE_URL = 'https://proxy.example.com/v1'
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key' })
    expect((client as any).baseURL).toBe('https://proxy.example.com/v1')
    delete process.env.DEEPSEEK_BASE_URL
  })

  it('deepseek provider cfg.baseURL tem prioridade sobre DEEPSEEK_BASE_URL do env', () => {
    process.env.DEEPSEEK_BASE_URL = 'https://env.example.com/v1'
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key', baseURL: 'https://cfg.example.com/v1' })
    expect((client as any).baseURL).toBe('https://cfg.example.com/v1')
    delete process.env.DEEPSEEK_BASE_URL
  })

  it('bedrock provider usa região padrão us-east-1', () => {
    const client = createLLMClient({ provider: 'bedrock' })
    expect((client as any).baseURL).toContain('us-east-1')
    expect((client as any).baseURL).toContain('bedrock-runtime')
  })

  it('bedrock provider usa região customizada', () => {
    const client = createLLMClient({ provider: 'bedrock', awsRegion: 'eu-west-1' })
    expect((client as any).baseURL).toContain('eu-west-1')
  })

  it('vertex provider usa URL do aiplatform', () => {
    const client = createLLMClient({ provider: 'vertex', gcpProject: 'my-project', gcpLocation: 'us-central1', gcpCredentials: '/tmp/sa.json' })
    expect((client as any).baseURL).toContain('aiplatform.googleapis.com')
    expect((client as any).baseURL).toContain('my-project')
  })

  it('vertex provider sem gcpCredentials lança erro', () => {
    expect(() => createLLMClient({ provider: 'vertex', gcpProject: 'my-project' })).toThrow('GCP_CREDENTIALS')
  })

  it('local provider com URL sem scheme adiciona http://', () => {
    const client = createLLMClient({ provider: 'local', localBaseUrl: 'localhost:11434/v1' })
    expect((client as any).baseURL).toMatch(/^http:\/\//)
  })

  it('local provider com URL com scheme preserva', () => {
    const client = createLLMClient({ provider: 'local', localBaseUrl: 'http://localhost:11434/v1' })
    expect((client as any).baseURL).toBe('http://localhost:11434/v1')
  })

  it('local provider com https preserva', () => {
    const client = createLLMClient({ provider: 'local', localBaseUrl: 'https://my-server.com/v1' })
    expect((client as any).baseURL).toBe('https://my-server.com/v1')
  })
})

describe('defaultModel', () => {
  it('deepseek retorna deepseek-v4-flash', () => {
    expect(defaultModel('deepseek')).toBe('deepseek-v4-flash')
  })

  it('bedrock retorna modelo deepseek', () => {
    expect(defaultModel('bedrock')).toBe('deepseek.deepseek-r1-v1:0')
  })

  it('vertex retorna modelo deepseek', () => {
    expect(defaultModel('vertex')).toBe('deepseek-ai/deepseek-r1')
  })

  it('local retorna llama3', () => {
    expect(defaultModel('local')).toBe('llama3')
  })
})
