import { describe, expect, it } from 'bun:test'
import { shouldShowWorkDivider } from '../../../src/ui/messages/MessageList.js'
import type { Message } from '../../../src/ui/App.js'

describe('shouldShowWorkDivider', () => {
  it('divides a final assistant reply after tool work, but not a conversational turn', () => {
    const worked: Message[] = [
      { role: 'user', content: 'fix it' },
      { role: 'tool', content: '✓ patch_file → changed' },
      { role: 'thinking', content: 'checking' },
      { role: 'assistant', content: 'done' },
    ]
    const conversation: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]

    expect(shouldShowWorkDivider(worked, 3)).toBe(true)
    expect(shouldShowWorkDivider(conversation, 1)).toBe(false)
  })
})
