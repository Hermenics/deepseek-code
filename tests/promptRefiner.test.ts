import { describe, expect, it } from 'bun:test'
import { previewPromptRefinement } from '../src/agent/promptRefiner.js'

describe('prompt refiner errors', () => {
  it('keeps the original prompt for non-Error rejection values', async () => {
    const client = { chat: { completions: { create: () => Promise.reject(null) } } } as never
    const original = 'A sufficiently long prompt that reaches the refiner'
    expect(await previewPromptRefinement(client, 'model', original)).toEqual({
      status: 'error', original, error: 'Unknown error',
    })
  })
})
