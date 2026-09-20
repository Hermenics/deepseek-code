/**
 * The OpenAI client appends `/chat/completions` to whatever base it is
 * given, so the version segment has to already be there. DeepSeek's own API
 * is the exception that makes this easy to get wrong: it answers at the host
 * root, while every OpenAI-compatible server answers under `/v1`.
 */
import { describe, expect, it } from 'bun:test'
import { normalizeBaseUrl } from '../src/agent/llmClient.js'

describe('normalizeBaseUrl', () => {
  it('sends a bare local proxy to /v1', () => {
    // The exact configuration that produced a bodyless 404.
    expect(normalizeBaseUrl('http://127.0.0.1:8001/')).toBe('http://127.0.0.1:8001/v1')
    expect(normalizeBaseUrl('http://127.0.0.1:8001')).toBe('http://127.0.0.1:8001/v1')
  })

  it('leaves the DeepSeek API at the host root, where it actually answers', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com')
    expect(normalizeBaseUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com')
  })

  it('never second-guesses a path the person wrote', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1')
    expect(normalizeBaseUrl('http://host:9000/openai/v1')).toBe('http://host:9000/openai/v1')
    expect(normalizeBaseUrl('http://host:9000/custom')).toBe('http://host:9000/custom')
  })

  it('does not stack a second /v1 onto one that is already there', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(normalizeBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
  })

  it('assumes http for a host typed without a scheme', () => {
    expect(normalizeBaseUrl('localhost:8001')).toBe('http://localhost:8001/v1')
    expect(normalizeBaseUrl('127.0.0.1:8001/v1')).toBe('http://127.0.0.1:8001/v1')
  })

  it('keeps https where it was given', () => {
    expect(normalizeBaseUrl('https://proxy.example.com')).toBe('https://proxy.example.com/v1')
  })

  it('preserves a query string', () => {
    expect(normalizeBaseUrl('https://proxy.example.com?tenant=a')).toBe('https://proxy.example.com/v1?tenant=a')
  })

  it('passes through what it cannot parse instead of mangling it', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
    expect(normalizeBaseUrl('http://')).toBe('http://')
  })
})
