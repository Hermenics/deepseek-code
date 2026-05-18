import { describe, it, expect } from 'bun:test'

// ─────────────────────────────────────────────────────────────────────────────
// Replica da lógica privada do orchestrator — testada isoladamente
// Fonte: src/agent/providers/proxy/services/orchestrator.ts
// ─────────────────────────────────────────────────────────────────────────────

type Message = { role: string; content: string }

function formatFullHistory(messages: Message[]): string {
  return messages
    .map((m) => {
      if (m.role === 'system') return `[System] ${m.content}`
      if (m.role === 'assistant') return `[Assistant] ${m.content}`
      if (m.role === 'tool') return `[Tool Result] ${m.content}`
      return m.content
    })
    .join('\n\n')
}

function buildToolResultContext(messages: Message[]): string {
  const lastUserIdx =
    messages
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.role === 'user')
      .pop()?.i ?? 0

  const toolContext = messages.slice(lastUserIdx + 1)

  return (
    toolContext
      .map((m) => {
        if (m.role === 'assistant') return `[You called a tool]`
        if (m.role === 'tool') return `[Tool Result]\n${m.content}`
        return m.content
      })
      .join('\n\n') +
    '\n\n[The tool has been executed. Now analyze the result above and continue. If you need another tool, call it. If you have enough information, respond to the user with text.]'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe('proxy-orchestrator', () => {
  describe('formatFullHistory', () => {
    it('should prefix system message with [System]', () => {
      const messages: Message[] = [{ role: 'system', content: 'You are helpful.' }]
      const result = formatFullHistory(messages)
      expect(result).toBe('[System] You are helpful.')
    })

    it('should prefix assistant message with [Assistant]', () => {
      const messages: Message[] = [{ role: 'assistant', content: 'Sure, I can help.' }]
      const result = formatFullHistory(messages)
      expect(result).toBe('[Assistant] Sure, I can help.')
    })

    it('should prefix tool message with [Tool Result]', () => {
      const messages: Message[] = [{ role: 'tool', content: '{"status": "ok"}' }]
      const result = formatFullHistory(messages)
      expect(result).toBe('[Tool Result] {"status": "ok"}')
    })

    it('should use content directly for user message (no prefix)', () => {
      const messages: Message[] = [{ role: 'user', content: 'What is 2+2?' }]
      const result = formatFullHistory(messages)
      expect(result).toBe('What is 2+2?')
    })

    it('should join multiple messages with double newline', () => {
      const messages: Message[] = [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
      ]
      const result = formatFullHistory(messages)
      expect(result).toBe('[System] Be concise.\n\nHello')
    })

    it('should format a full conversation with all four roles correctly', () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are an assistant.' },
        { role: 'user', content: 'List files.' },
        { role: 'assistant', content: 'Calling ls tool.' },
        { role: 'tool', content: 'file1.txt\nfile2.txt' },
      ]
      const result = formatFullHistory(messages)
      expect(result).toBe(
        '[System] You are an assistant.\n\nList files.\n\n[Assistant] Calling ls tool.\n\n[Tool Result] file1.txt\nfile2.txt'
      )
    })

    it('should return empty string for empty messages array', () => {
      expect(formatFullHistory([])).toBe('')
    })

    it('should handle unknown role as plain content (no prefix)', () => {
      const messages: Message[] = [{ role: 'function', content: 'some output' }]
      const result = formatFullHistory(messages)
      expect(result).toBe('some output')
    })

    it('should preserve multiline content inside a message', () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'Line one\nLine two\nLine three' },
      ]
      const result = formatFullHistory(messages)
      expect(result).toBe('[Assistant] Line one\nLine two\nLine three')
    })

    it('should handle empty content string', () => {
      const messages: Message[] = [{ role: 'system', content: '' }]
      const result = formatFullHistory(messages)
      expect(result).toBe('[System] ')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // buildToolResultContext — lógica do branch `lastMsg.role === 'tool'`
  // ─────────────────────────────────────────────────────────────────────────

  describe('buildToolResultContext', () => {
    it('should wrap assistant turn as [You called a tool] and tool turn as [Tool Result]', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read the file.' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'file contents here' },
      ]
      const result = buildToolResultContext(messages)
      expect(result).toContain('[You called a tool]')
      expect(result).toContain('[Tool Result]\nfile contents here')
    })

    it('should append the continuation instruction at the end', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Do something.' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'result' },
      ]
      const result = buildToolResultContext(messages)
      expect(result).toContain(
        '[The tool has been executed. Now analyze the result above and continue.'
      )
    })

    it('should slice context starting after the last user message', () => {
      const messages: Message[] = [
        { role: 'user', content: 'First question.' },
        { role: 'assistant', content: 'First answer.' },
        { role: 'user', content: 'Second question.' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'tool output' },
      ]
      const result = buildToolResultContext(messages)
      // Context from the second user message onward — first answer must NOT appear
      expect(result).not.toContain('First answer.')
      expect(result).toContain('[You called a tool]')
      expect(result).toContain('[Tool Result]\ntool output')
    })

    it('should handle multiple tool results after the last user message', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Run two tools.' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'result A' },
        { role: 'tool', content: 'result B' },
      ]
      const result = buildToolResultContext(messages)
      expect(result).toContain('[Tool Result]\nresult A')
      expect(result).toContain('[Tool Result]\nresult B')
    })

    it('should fall back to index 0 when there is no user message', () => {
      // No user message — lastUserIdx defaults to 0, so slice starts at index 1
      const messages: Message[] = [
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'orphan result' },
      ]
      const result = buildToolResultContext(messages)
      expect(result).toContain('[Tool Result]\norphan result')
    })

    it('should separate context blocks with double newline', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Go.' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: 'done' },
      ]
      const result = buildToolResultContext(messages)
      expect(result).toContain('[You called a tool]\n\n[Tool Result]\ndone')
    })

    it('should include tool result content verbatim (no extra prefix)', () => {
      const rawOutput = '{"exit_code": 0, "stdout": "hello world"}'
      const messages: Message[] = [
        { role: 'user', content: 'Run command.' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: rawOutput },
      ]
      const result = buildToolResultContext(messages)
      expect(result).toContain(`[Tool Result]\n${rawOutput}`)
    })
  })
})
