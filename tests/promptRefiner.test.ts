import { describe, expect, it } from 'bun:test'
import { combineOriginalWithRefinement, previewPromptRefinement, refinePrompt } from '../src/agent/promptRefiner.js'
import { CONVERSATION_MESSAGE_BYTES } from '../src/agent/toolOutputBudget.js'

describe('prompt refiner errors', () => {
  it('rejects an oversized refinement prompt before provider dispatch', async () => {
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; throw new Error('must not run') } } } } as never
    const result = await previewPromptRefinement(client, 'model', 'x'.repeat(CONVERSATION_MESSAGE_BYTES))
    expect(result.status).toBe('error')
    expect(result.error).toContain('serialized provider request exceeds the 4 MiB UTF-8 limit')
    expect(calls).toBe(0)
  })

  it('rejects an oversized request option before provider dispatch', async () => {
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; throw new Error('must not run') } } } } as never
    const result = await previewPromptRefinement(client, 'm'.repeat(CONVERSATION_MESSAGE_BYTES), 'Please inspect this request and improve clarity.')
    expect(result.status).toBe('error')
    expect(result.error).toContain('serialized provider request exceeds the 4 MiB UTF-8 limit')
    expect(calls).toBe(0)
  })

  it('rejects an oversized serialized provider response without retaining the refinement', async () => {
    const original = 'Please inspect this implementation and explain a safe refactor.'
    const client = {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: 'x'.repeat(CONVERSATION_MESSAGE_BYTES) } }] }) } },
    } as never
    const result = await previewPromptRefinement(client, 'model', original)

    expect(result).toMatchObject({ status: 'error', original })
    expect(result.refined).toBeUndefined()
    expect(result.error).toContain('Serialized provider response message exceeds the 4 MiB UTF-8 limit')
  })

  it('keeps the original request and marks the generated text as optional context', () => {
    const original = 'Fix the parser bug without changing the public API.'
    const refined = combineOriginalWithRefinement(original, 'Inspect the parser and add a regression test.')

    expect(refined.startsWith(original)).toBe(true)
    expect(refined).toContain('<optional-request-clarification>')
    expect(refined).toContain('Inspect the parser')
  })

  it('keeps the original prompt for non-Error rejection values', async () => {
    const client = { chat: { completions: { create: () => Promise.reject(null) } } } as never
    const original = 'A sufficiently long prompt that reaches the refiner'
    expect(await previewPromptRefinement(client, 'model', original)).toEqual({
      status: 'error', original, error: 'Unknown error',
    })
  })

  it('passes the optional signal to the completion request and reports an abort', async () => {
    const controller = new AbortController()
    let passedSignal: AbortSignal | undefined
    const client = { chat: { completions: { create: (_request: unknown, options?: { signal?: AbortSignal }) => {
      passedSignal = options?.signal
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    } } } } as never
    const original = 'Please inspect the parser and fix the malformed nested expression.'
    const pending = previewPromptRefinement(client, 'model', original, 30, controller.signal)

    expect(passedSignal).toBe(controller.signal)
    controller.abort(new Error('request aborted'))
    expect(await pending).toEqual({ status: 'error', original, error: 'request aborted' })
  })

  it('propagates an abort through refinePrompt and falls back to the original request', async () => {
    const controller = new AbortController()
    let passedSignal: AbortSignal | undefined
    const client = { chat: { completions: { create: (_request: unknown, options?: { signal?: AbortSignal }) => {
      passedSignal = options?.signal
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      })
    } } } } as never
    const original = 'Please update the cache implementation and verify its expiration behavior.'
    const pending = refinePrompt(client, 'model', original, controller.signal)

    expect(passedSignal).toBe(controller.signal)
    controller.abort(new Error('request aborted'))
    expect(await pending).toBe(original)
  })

  it('preserves native Dynamic Workflow requests without consulting the refiner model', async () => {
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; throw new Error('must not run') } } } } as never
    for (const original of [
      'Create a Dynamic Workflow with two agents to review this project in parallel.',
      'Crie um dunakic workflows com agentes para revisar este projeto em paralelo.',
      'Create dynamic workflows that use reader agents to analyze the existing tests.',
    ]) {
      expect(await previewPromptRefinement(client, 'model', original)).toEqual({ status: 'skip', original })
    }
    expect(calls).toBe(0)
  })
})
