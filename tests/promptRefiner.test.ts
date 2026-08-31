import { describe, expect, it } from 'bun:test'
import { combineOriginalWithRefinement, previewPromptRefinement } from '../src/agent/promptRefiner.js'

describe('prompt refiner errors', () => {
  it('keeps the original request and marks the generated text as optional context', () => {
    const original = 'Corrija o bug do parser sem alterar a API pública.'
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

  it('preserves native Dynamic Workflow requests without consulting the refiner model', async () => {
    let calls = 0
    const client = { chat: { completions: { create: async () => { calls++; throw new Error('must not run') } } } } as never
    for (const original of [
      'Crie um Dynamic Workflow com dois agentes para revisar este projeto em paralelo.',
      'Crie um dunakic workflows com agentes para revisar este projeto em paralelo.',
      'Crie workflows dinâmicos que usem agentes leitores para analisar os testes existentes.',
    ]) {
      expect(await previewPromptRefinement(client, 'model', original)).toEqual({ status: 'skip', original })
    }
    expect(calls).toBe(0)
  })
})
