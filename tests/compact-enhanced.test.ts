import { describe, expect, it } from 'bun:test'
import { enhancedMicroCompact } from '../src/services/compact/microCompact.js'
import { runPostCompactCleanup } from '../src/services/compact/postCompactCleanup.js'

describe('enhanced micro-compaction', () => {
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
