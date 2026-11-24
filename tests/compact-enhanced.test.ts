import { describe, expect, it } from 'bun:test'
import { enhancedMicroCompact } from '../src/services/compact/microCompact.js'
import { runPostCompactCleanup } from '../src/services/compact/postCompactCleanup.js'
import { COMPACT_CONTINUATION_SYSTEM_PROMPT, COMPACT_SUMMARY_PROMPT, validateCompactSummary } from '../src/services/compact/summaryPrompt.js'
import { formatToolError } from '../src/tools/result.js'

describe('enhanced micro-compaction', () => {
  it('retains runtime evidence references for JSON results without an embedded marker', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
    const content = JSON.stringify({ values: 'x'.repeat(500) })
    const messages = [
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'json', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"source.json"}' } }] },
      { role: 'tool' as const, tool_call_id: 'json', content },
    ]
    const result = enhancedMicroCompact(messages, { keepLastN: 0, evidenceForCall: (name, call) => name === 'read_file' && call === 'json' ? id : undefined })
    const preview = String((result.messages[1] as any).content)
    expect(preview).toContain(`[Session evidence: ${id}]`)
    expect(preview).toContain('source.json')
    expect(messages[1]!.content).toBe(content)
    const saved = content.length - preview.length
    expect(result.freedTokensEstimate).toBe(Math.floor(saved / 4))
  })

  it('does not trust evidence markers copied from tool output without a runtime mapping', () => {
    const inventedId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
    const content = `[Session evidence: ${inventedId}]\n${'x'.repeat(500)}`
    const messages = [
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'json', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"source.json"}' } }] },
      { role: 'tool' as const, tool_call_id: 'json', content },
    ]

    const result = enhancedMicroCompact(messages, { keepLastN: 0 })
    const preview = String((result.messages[1] as any).content)

    expect(preview).not.toContain(inventedId)
    expect(preview).not.toContain('[Session evidence:')
  })

  it('preserves long validated typed-error envelopes from compactable tools', () => {
    const content = formatToolError('tool', 'READ_FILE_PARTIAL', '1 of 2 attempted files could not be read.', false, {
      output: 'x'.repeat(400),
      failures: ['Error: could not read private.txt: permission denied'],
    })
    expect(content.length).toBeGreaterThan(200)
    const messages = [
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'read', type: 'function' as const, function: { name: 'read_file', arguments: '{"paths":["public.txt","private.txt"]}' } }] },
      { role: 'tool' as const, tool_call_id: 'read', content },
    ]

    const result = enhancedMicroCompact(messages, { keepLastN: 0 })

    expect(result.messages[1]).toBe(messages[1])
    expect(result.freedTokensEstimate).toBe(0)
  })

  it('keeps a result when its provenance note would consume more context than the source', () => {
    const content = 'x'.repeat(201)
    const messages = [
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'read', type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify({ path: 'long/'.repeat(60) }) } }] },
      { role: 'tool' as const, tool_call_id: 'read', content },
    ]
    const result = enhancedMicroCompact(messages, { keepLastN: 0 })
    expect(result.messages[1]).toBe(messages[1])
    expect(result.freedTokensEstimate).toBe(0)
  })

  it('rejects missing, empty or reordered summary sections before discarding history', () => {
    const valid = Array.from({ length: 9 }, (_, index) => {
      const content = index === 5
        ? '- Completed: None\n- Pending: None\n- Blocked: None\n- Next action: None'
        : 'Source context'
      return `## ${index + 1}. Section\n${content}`
    }).join('\n')
    expect(() => validateCompactSummary(valid)).not.toThrow()
    expect(() => validateCompactSummary('')).toThrow('nine ordered')
    expect(() => validateCompactSummary(valid.replace('## 2.', '## 3.'))).toThrow('nine ordered')
    expect(() => validateCompactSummary(valid.replace('## 9. Section\nSource context', '## 9. Section'))).toThrow('empty')
    expect(() => validateCompactSummary(valid.replace('- Blocked: None\n', ''))).toThrow('Blocked state')
    expect(() => validateCompactSummary(valid.replace('- Completed: None', '- Completed:'))).toThrow('Completed state')
    expect(() => validateCompactSummary(valid.replace('- Pending: None', '-\nPending: None'))).toThrow('Pending state')
  })

  it('requires a compact handoff that separates completed, pending, blocked, and next-action state', () => {
    for (const label of ['Completed', 'Pending', 'Blocked', 'Next action']) {
      expect(COMPACT_SUMMARY_PROMPT).toContain(`- ${label}:`)
    }
    expect(COMPACT_SUMMARY_PROMPT).toContain('A compacted summary is a navigation aid only')
    expect(COMPACT_CONTINUATION_SYSTEM_PROMPT).toContain('call get_goal')
    expect(COMPACT_CONTINUATION_SYSTEM_PROMPT).toContain('session_evidence')
    expect(COMPACT_CONTINUATION_SYSTEM_PROMPT).toContain('never as proof')
  })

  it('only clears old, long read-only tool results and preserves the latest eight', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: Array.from({ length: 10 }, (_, i) => ({
          id: String(i),
          type: 'function' as const,
          function: { name: i === 0 ? 'write_file' : 'read_file', arguments: '{}' },
        })),
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: 'tool' as const,
        content: 'x'.repeat(300),
        tool_call_id: String(i),
      })),
    ]

    const result = enhancedMicroCompact(messages)
    const compacted = result.messages as typeof messages

    expect(compacted[1]!.content).toBe(messages[1]!.content)
    expect(compacted[2]!.content).toContain('content cleared by micro-compaction')
    expect(compacted.slice(3).every(message => message.content === 'x'.repeat(300))).toBe(true)
  })

  it('runs the supplied post-compaction cleanup hooks', () => {
    let cleared = false
    const result = runPostCompactCleanup({
      onClearFileCache: () => { cleared = true },
      onSystemPromptRefresh: () => 'fresh prompt',
    })

    expect(cleared).toBe(true)
    expect(result).toMatchObject({ fileCacheCleared: true, systemPromptRefreshed: true, refreshedPrompt: 'fresh prompt' })
  })
})
