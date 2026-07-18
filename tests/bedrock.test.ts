import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { SignatureV4 } from '@smithy/signature-v4'
import { createBedrockFetch, createBedrockMantleFetch } from '../src/agent/providers/bedrock'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock fromIni to return fake AWS credentials without touching ~/.aws
const fakeCredentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  sessionToken: undefined,
}

mock.module('@aws-sdk/credential-providers', () => ({
  fromIni: (_opts: { profile: string }) => async () => fakeCredentials,
}))

// Capture what globalThis.fetch receives so we can inspect signed headers
let capturedRequest: Request | undefined
let capturedSignal: AbortSignal | null | undefined
const fakeResponse = new Response('{"ok":true}', { status: 200 })

const originalFetch = globalThis.fetch

beforeEach(() => {
  capturedRequest = undefined
  capturedSignal = undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedSignal = init?.signal
    capturedRequest = new Request(input, init)
    return fakeResponse.clone()
  }) as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createBedrockFetch', () => {
  it('retorna uma função', () => {
    const bedrockFetch = createBedrockFetch('us-east-1', 'default')
    expect(typeof bedrockFetch).toBe('function')
  })

  it('adiciona headers SigV4 (Authorization e X-Amz-Date) ao request', async () => {
    const bedrockFetch = createBedrockFetch('us-east-1', 'default')

    await bedrockFetch('https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    })

    expect(capturedRequest).toBeDefined()
    const authHeader = capturedRequest!.headers.get('authorization')
    expect(authHeader).toBeTruthy()
    // SigV4 Authorization starts with the signing algorithm
    expect(authHeader!).toStartWith('AWS4-HMAC-SHA256')

    const dateHeader = capturedRequest!.headers.get('x-amz-date')
    expect(dateHeader).toBeTruthy()
    // X-Amz-Date format: YYYYMMDDTHHMMSSZ
    expect(dateHeader!).toMatch(/^\d{8}T\d{6}Z$/)
  })

  it('funciona com URL string como input', async () => {
    const bedrockFetch = createBedrockFetch('us-west-2', 'default')

    await bedrockFetch('https://bedrock-runtime.us-west-2.amazonaws.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.headers.get('authorization')).toStartWith('AWS4-HMAC-SHA256')
  })

  it('funciona com Request object como input', async () => {
    const bedrockFetch = createBedrockFetch('us-east-1', 'default')

    const req = new Request('https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })

    await bedrockFetch(req)

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.headers.get('authorization')).toStartWith('AWS4-HMAC-SHA256')
  })

  it('passa a region correta no signing (presente no header Authorization)', async () => {
    const bedrockFetch = createBedrockFetch('eu-west-1', 'myprofile')

    await bedrockFetch('https://bedrock-runtime.eu-west-1.amazonaws.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    })

    const authHeader = capturedRequest!.headers.get('authorization')!
    // SigV4 credential scope includes region: AKID/date/region/service/aws4_request
    expect(authHeader).toContain('eu-west-1')
    expect(authHeader).toContain('bedrock')
  })

  it('remove campos não suportados pelo Bedrock nativo (model, stream, tools) do body', async () => {
    const bedrockFetch = createBedrockFetch('us-east-1', 'default')
    const body = JSON.stringify({ model: 'deepseek', messages: [{ role: 'user', content: 'hi' }] })

    await bedrockFetch('https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    const receivedBody = await capturedRequest!.text()
    const parsed = JSON.parse(receivedBody)
    // model é removido (vai na URL) e messages é preservado
    expect(parsed.model).toBeUndefined()
    expect(parsed.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('sobrescreve header Authorization existente (ex: Bearer bedrock do OpenAI SDK)', async () => {
    const bedrockFetch = createBedrockFetch('us-east-1', 'default')

    await bedrockFetch('https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer bedrock',
      },
      body: JSON.stringify({ test: true }),
    })

    const authHeader = capturedRequest!.headers.get('authorization')!
    // Must NOT be the original "Bearer bedrock" — must be SigV4
    expect(authHeader).not.toBe('Bearer bedrock')
    expect(authHeader).toStartWith('AWS4-HMAC-SHA256')
  })

  it('propaga o AbortSignal nos wrappers native e mantle', async () => {
    const controller = new AbortController()
    await createBedrockFetch('us-east-1', 'default')('https://unused.example', {
      method: 'POST', body: JSON.stringify({ model: 'deepseek', messages: [] }), signal: controller.signal,
    })
    expect(capturedSignal).toBe(controller.signal)

    const mantleController = new AbortController()
    await createBedrockMantleFetch('us-east-1', 'default')('https://unused.example', {
      method: 'POST', body: JSON.stringify({ model: 'deepseek-v3.2', messages: [] }), signal: mantleController.signal,
    })
    expect(capturedSignal).toBe(mantleController.signal)
  })
})
