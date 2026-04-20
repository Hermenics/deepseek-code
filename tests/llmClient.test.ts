import { describe, it, expect } from 'bun:test'
import { createLLMClient, defaultModel } from '../src/agent/llmClient.js'

describe('createLLMClient', () => {
  it('deepseek provider retorna cliente com baseURL correta', () => {
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'test-key' })
    expect(client).toBeDefined()
    expect((client as any).baseURL).toBe('https://api.deepseek.com')
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
    const client = createLLMClient({ provider: 'vertex', gcpProject: 'my-project', gcpLocation: 'us-central1' })
    expect((client as any).baseURL).toContain('aiplatform.googleapis.com')
    expect((client as any).baseURL).toContain('my-project')
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
  it('deepseek retorna deepseek-chat', () => {
    expect(defaultModel('deepseek')).toBe('deepseek-chat')
  })

  it('bedrock retorna modelo claude', () => {
    expect(defaultModel('bedrock')).toContain('claude')
  })

  it('vertex retorna modelo gemini', () => {
    expect(defaultModel('vertex')).toContain('gemini')
  })

  it('local retorna llama3', () => {
    expect(defaultModel('local')).toBe('llama3')
  })
})
