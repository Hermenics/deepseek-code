import { describe, expect, it } from 'bun:test'
import { formatContextLimit } from '../src/agent/cost.js'
import { getKnownDescription, getModelDescription, isCachedDescriptionFresh, isGenericModelDescription } from '../src/agent/modelInfo.js'

describe('model descriptions', () => {
  it('formats context limits compactly', () => {
    expect(formatContextLimit(1_000_000)).toBe('1M context')
    expect(formatContextLimit(1_050_000)).toBe('1.05M context')
    expect(formatContextLimit(128_000)).toBe('128k context')
  })

  it('rejects generated descriptions that only say the context is unknown', () => {
    expect(isGenericModelDescription('AI model variant; context window size unknown.')).toBe(true)
    expect(isGenericModelDescription('Astra line model; 128000 context')).toBe(true)
    expect(isGenericModelDescription('Compact GPT-5.4 model for fast, efficient general-purpose tasks')).toBe(true)
    expect(isGenericModelDescription('Fast coding model · 128k context')).toBe(false)
  })

  it('does not invent metadata for an uncatalogued model', () => {
    expect(getKnownDescription('uncatalogued-model')).toBe('')
    expect(getModelDescription('uncatalogued-model')).toBe('')
  })

  it('expires researched descriptions after 30 days and rejects legacy or future timestamps', () => {
    const now = Date.parse('2026-10-16T12:00:00.000Z')
    expect(isCachedDescriptionFresh('2026-10-01T12:00:00.000Z', now)).toBe(true)
    expect(isCachedDescriptionFresh('2026-09-16T12:00:00.000Z', now)).toBe(false)
    expect(isCachedDescriptionFresh(undefined, now)).toBe(false)
    expect(isCachedDescriptionFresh('2026-10-17T12:00:00.000Z', now)).toBe(false)
  })

  it('uses researched catalog descriptions for the OpenAI IDs', () => {
    expect(getModelDescription('gpt-6-astra', 1_050_000)).toContain('complex reasoning')
    expect(getModelDescription('gpt-5.4-mini', 400_000)).toContain('400k context')
  })
})
