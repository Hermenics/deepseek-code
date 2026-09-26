import { describe, expect, it } from 'bun:test'
import { collapseToolGroups, toolGroupSummary } from '../../../src/ui/messages/toolGroups.js'
import type { Message } from '../../../src/ui/App.js'

const items = (messages: Message[]) => messages.map((message, index) => ({ kind: 'message' as const, message, index }))

describe('collapseToolGroups', () => {
  it('folds consecutive read-only tools into one Claude Code style summary, deferring thinking past it', () => {
    const result = collapseToolGroups(items([
      { role: 'user', content: 'fix it' },
      { role: 'tool', content: '✓ read_file → a.ts, b.ts' },
      { role: 'thinking', content: 'hmm' },
      { role: 'tool', content: '✓ grep → TODO' },
      { role: 'tool', content: '✓ read_file → a.ts' },
      { role: 'tool', content: '✓ read_folder → src' },
      { role: 'tool', content: '✓ patch_file → {}' },
      { role: 'tool', content: '✓ glob → *.ts' },
      { role: 'step', content: 'Testando', doneLabel: 'Testou' },
      { role: 'tool', content: '✓ read_file → c.ts' },
    ]))
    expect(result.map(item => item.kind === 'message' ? item.message.role : item.kind))
      .toEqual(['user', 'group', 'thinking', 'tool', 'group', 'step', 'group'])
    const [first, second] = result.filter(item => item.kind === 'group')
    expect(first).toMatchObject({ index: 1 })
    expect(toolGroupSummary(first!.group)).toBe('Searched for 1 pattern, read 2 files, listed 1 directory')
    expect(toolGroupSummary(second!.group)).toBe('Searched for 1 pattern')
  })
})
