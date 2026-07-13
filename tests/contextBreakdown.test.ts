import { describe, it, expect } from 'bun:test'
import { estimateContextBreakdown, formatContextBreakdown } from '../src/agent/contextBreakdown.js'
import type { ContextSnapshotInput } from '../src/agent/contextBreakdown.js'

function makeInput(overrides: Partial<ContextSnapshotInput> = {}): ContextSnapshotInput {
  return {
    systemPrompt: 'You are a helpful assistant.',
    toolsPayload: JSON.stringify([{ name: 'read_file', description: 'reads a file', parameters: {} }]),
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    contextUsage: 1000,
    contextLimit: 10000,
    ...overrides,
  }
}

describe('estimateContextBreakdown', () => {
  it('returns stale:true when contextUsage is 0', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 0 }))
    expect(result.stale).toBe(true)
    expect(result.total).toBe(0)
    expect(result.categories).toHaveLength(0)
  })

  it('proportional distribution sums exactly to contextUsage', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 5000 }))
    // Categories excluding Free
    const usedCategories = result.categories.filter(c => c.name !== 'Free')
    const sum = usedCategories.reduce((acc, c) => acc + c.tokens, 0)
    expect(sum).toBe(5000)
  })

  it('total matches contextUsage exactly', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 3000 }))
    expect(result.total).toBe(3000)
  })

  it('limit matches contextLimit', () => {
    const result = estimateContextBreakdown(makeInput({ contextLimit: 128000 }))
    expect(result.limit).toBe(128000)
  })

  it('usagePercent is correct ratio', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 1000, contextLimit: 10000 }))
    expect(result.usagePercent).toBeCloseTo(10, 1)
  })

  it('works with empty messages array', () => {
    const result = estimateContextBreakdown(makeInput({ messages: [], contextUsage: 500 }))
    expect(result.stale).toBe(false)
    expect(result.total).toBe(500)
  })

  it('memory is not double-counted with system prompt', () => {
    const prompt = 'Base system prompt.\n--- MEMORY ---\nsome memory\n--- END MEMORY ---'
    const result = estimateContextBreakdown(makeInput({ systemPrompt: prompt, contextUsage: 2000 }))
    // Both Memory and System Prompt categories should exist separately
    const systemCat = result.categories.find(c => c.name === 'System Prompt')
    const memoryCat = result.categories.find(c => c.name === 'Memory')
    // Neither should be null if both have content
    expect(systemCat).toBeDefined()
    expect(memoryCat).toBeDefined()
    // They should not overlap — total used tokens = sum of non-Free categories
    const usedSum = result.categories.filter(c => c.name !== 'Free').reduce((acc, c) => acc + c.tokens, 0)
    expect(usedSum).toBe(2000)
  })

  it('role:tool messages are counted in Tool Results', () => {
    const messages = [
      { role: 'user', content: 'run something' },
      { role: 'assistant', content: null, tool_calls: [{ id: '1', function: { name: 'shell', arguments: '{}' } }] },
      { role: 'tool', content: 'output here output here output here output here output here' },
    ]
    const result = estimateContextBreakdown(makeInput({ messages, contextUsage: 1000 }))
    const toolResultsCat = result.categories.find(c => c.name === 'Tool Results')
    expect(toolResultsCat).toBeDefined()
    expect(toolResultsCat!.tokens).toBeGreaterThan(0)
  })

  it('Bedrock-style user messages with <tool_result> are counted in Tool Results', () => {
    const messages = [
      { role: 'user', content: 'do something' },
      { role: 'assistant', content: '<tool_call><name>shell</name><args>{}</args></tool_call>' },
      { role: 'user', content: '<tool_result>\n<name>shell</name>\n<result>done</result>\n</tool_result>' },
    ]
    const result = estimateContextBreakdown(makeInput({ messages, contextUsage: 1000 }))
    const toolResultsCat = result.categories.find(c => c.name === 'Tool Results')
    expect(toolResultsCat).toBeDefined()
    expect(toolResultsCat!.tokens).toBeGreaterThan(0)
  })

  it('no suggestions when usage is low', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 100, contextLimit: 100000 }))
    expect(result.suggestions).toHaveLength(0)
  })

  it('triggers compact warning suggestion at >=85% usage', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 8600, contextLimit: 10000 }))
    const hasCompactWarning = result.suggestions.some(s => s.includes('/compact'))
    expect(hasCompactWarning).toBe(true)
  })

  it('triggers tool results suggestion when tool results >40% of used', () => {
    // Make a big tool result and small system/messages
    const longToolResult = 'x'.repeat(5000)
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'tool', content: longToolResult },
    ]
    const result = estimateContextBreakdown(makeInput({
      messages,
      systemPrompt: 'short',
      toolsPayload: '[]',
      contextUsage: 5000,
      contextLimit: 100000,
    }))
    const hasToolSuggestion = result.suggestions.some(s => s.includes('Tool results') || s.includes('tool'))
    expect(hasToolSuggestion).toBe(true)
  })

  it('categories percentages are based on contextUsage not limit', () => {
    const result = estimateContextBreakdown(makeInput({ contextUsage: 1000, contextLimit: 100000 }))
    const used = result.categories.filter(c => c.name !== 'Free')
    // Each percent should be relative to the 1000 used tokens
    const totalPct = used.reduce((acc, c) => acc + c.percent, 0)
    expect(totalPct).toBeCloseTo(100, 0)
  })
})

describe('formatContextBreakdown', () => {
  it('returns stale message when stale is true', () => {
    const result = formatContextBreakdown({
      categories: [],
      total: 0,
      limit: 100000,
      usagePercent: 0,
      suggestions: [],
      stale: true,
    })
    expect(result).toContain('Waiting for')
  })

  it('returns formatted output with percentage', () => {
    const breakdown = estimateContextBreakdown(makeInput({ contextUsage: 1000, contextLimit: 10000 }))
    const output = formatContextBreakdown(breakdown)
    expect(output).toContain('10.0%')
    expect(output).toContain('1,000')
    expect(output).toContain('10,000')
  })

  it('includes suggestion text when present', () => {
    const breakdown = estimateContextBreakdown(makeInput({ contextUsage: 9000, contextLimit: 10000 }))
    const output = formatContextBreakdown(breakdown)
    expect(output).toContain('/compact')
  })
})
