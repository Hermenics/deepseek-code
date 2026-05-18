import { describe, it, expect } from 'bun:test'
import {
  formatStreamReasoning,
  formatStreamChunk,
  formatStreamToolCall,
  formatResponse,
  parseRequest,
} from '../src/agent/providers/proxy/formatters/openai.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseSseChunk(raw: string): any {
  // SSE format: "data: {...}\n\n"
  const line = raw.trim()
  expect(line.startsWith('data: ')).toBe(true)
  return JSON.parse(line.slice('data: '.length))
}

// ─────────────────────────────────────────────────────────────────────────────
// formatStreamReasoning
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStreamReasoning', () => {
  it('should return a string starting with "data: "', () => {
    const result = formatStreamReasoning('thinking...', 'deepseek-v3')
    expect(result.startsWith('data: ')).toBe(true)
  })

  it('should end with double newline (SSE terminator)', () => {
    const result = formatStreamReasoning('thinking...', 'deepseek-v3')
    expect(result.endsWith('\n\n')).toBe(true)
  })

  it('should have object "chat.completion.chunk"', () => {
    const chunk = parseSseChunk(formatStreamReasoning('hello', 'deepseek-v3'))
    expect(chunk.object).toBe('chat.completion.chunk')
  })

  it('should include reasoning_content in choices[0].delta', () => {
    const chunk = parseSseChunk(formatStreamReasoning('my reasoning', 'deepseek-v3'))
    expect(chunk.choices[0].delta.reasoning_content).toBe('my reasoning')
  })

  it('should NOT include content in delta (only reasoning_content)', () => {
    const chunk = parseSseChunk(formatStreamReasoning('think', 'deepseek-v3'))
    expect(chunk.choices[0].delta.content).toBeUndefined()
  })

  it('should set finish_reason to null', () => {
    const chunk = parseSseChunk(formatStreamReasoning('think', 'deepseek-v3'))
    expect(chunk.choices[0].finish_reason).toBeNull()
  })

  it('should include the model name', () => {
    const chunk = parseSseChunk(formatStreamReasoning('think', 'deepseek-r1'))
    expect(chunk.model).toBe('deepseek-r1')
  })

  it('should generate a unique id per call', () => {
    const a = parseSseChunk(formatStreamReasoning('x', 'model'))
    const b = parseSseChunk(formatStreamReasoning('x', 'model'))
    expect(a.id).not.toBe(b.id)
  })

  it('should handle empty reasoning string', () => {
    const chunk = parseSseChunk(formatStreamReasoning('', 'model'))
    expect(chunk.choices[0].delta.reasoning_content).toBe('')
  })

  it('should handle multi-line reasoning text', () => {
    const text = 'step 1\nstep 2\nstep 3'
    const chunk = parseSseChunk(formatStreamReasoning(text, 'model'))
    expect(chunk.choices[0].delta.reasoning_content).toBe(text)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatStreamChunk
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStreamChunk', () => {
  it('should return SSE format with data: prefix and double newline', () => {
    const result = formatStreamChunk('hello', 'deepseek-v3')
    expect(result.startsWith('data: ')).toBe(true)
    expect(result.endsWith('\n\n')).toBe(true)
  })

  it('should have object "chat.completion.chunk"', () => {
    const chunk = parseSseChunk(formatStreamChunk('hello', 'deepseek-v3'))
    expect(chunk.object).toBe('chat.completion.chunk')
  })

  it('should include token in choices[0].delta.content', () => {
    const chunk = parseSseChunk(formatStreamChunk('world', 'deepseek-v3'))
    expect(chunk.choices[0].delta.content).toBe('world')
  })

  it('should set finish_reason to null', () => {
    const chunk = parseSseChunk(formatStreamChunk('x', 'model'))
    expect(chunk.choices[0].finish_reason).toBeNull()
  })

  it('should include the model name', () => {
    const chunk = parseSseChunk(formatStreamChunk('x', 'my-model'))
    expect(chunk.model).toBe('my-model')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatStreamToolCall
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStreamToolCall', () => {
  const toolCall = {
    id: 'toolu_abc123',
    name: 'read_file',
    arguments: { path: 'src/index.ts' },
  }

  it('should return SSE format with data: prefix and double newline', () => {
    const result = formatStreamToolCall(toolCall, 'deepseek-v3')
    expect(result.startsWith('data: ')).toBe(true)
    expect(result.endsWith('\n\n')).toBe(true)
  })

  it('should have finish_reason "tool_calls"', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'deepseek-v3'))
    expect(chunk.choices[0].finish_reason).toBe('tool_calls')
  })

  it('should include tool_calls array in delta', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'deepseek-v3'))
    expect(Array.isArray(chunk.choices[0].delta.tool_calls)).toBe(true)
    expect(chunk.choices[0].delta.tool_calls).toHaveLength(1)
  })

  it('should include the tool call id', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'deepseek-v3'))
    expect(chunk.choices[0].delta.tool_calls[0].id).toBe('toolu_abc123')
  })

  it('should set type to "function"', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'deepseek-v3'))
    expect(chunk.choices[0].delta.tool_calls[0].type).toBe('function')
  })

  it('should include function.name', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'deepseek-v3'))
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe('read_file')
  })

  it('should stringify arguments as JSON string', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'deepseek-v3'))
    const args = chunk.choices[0].delta.tool_calls[0].function.arguments
    expect(typeof args).toBe('string')
    expect(JSON.parse(args)).toEqual({ path: 'src/index.ts' })
  })

  it('should include the model name', () => {
    const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'my-model'))
    expect(chunk.model).toBe('my-model')
  })

  it('should handle tool call with empty arguments', () => {
    const tc = { id: 'toolu_x', name: 'list_files', arguments: {} }
    const chunk = parseSseChunk(formatStreamToolCall(tc, 'model'))
    expect(JSON.parse(chunk.choices[0].delta.tool_calls[0].function.arguments)).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('formatResponse', () => {
  describe('normal text response (no tool call, no thinking)', () => {
    it('should have object "chat.completion"', () => {
      const res = formatResponse('deepseek-v3', 'Hello world')
      expect(res.object).toBe('chat.completion')
    })

    it('should include content in message', () => {
      const res = formatResponse('deepseek-v3', 'Hello world')
      expect(res.choices[0].message.content).toBe('Hello world')
    })

    it('should have finish_reason "stop"', () => {
      const res = formatResponse('deepseek-v3', 'Hello world')
      expect(res.choices[0].finish_reason).toBe('stop')
    })

    it('should have role "assistant"', () => {
      const res = formatResponse('deepseek-v3', 'Hello world')
      expect(res.choices[0].message.role).toBe('assistant')
    })

    it('should NOT include reasoning_content when thinking is absent', () => {
      const res = formatResponse('deepseek-v3', 'Hello world')
      expect((res.choices[0].message as any).reasoning_content).toBeUndefined()
    })

    it('should include the model name', () => {
      const res = formatResponse('my-model', 'text')
      expect(res.model).toBe('my-model')
    })

    it('should include usage with zero tokens', () => {
      const res = formatResponse('model', 'text')
      expect(res.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
    })
  })

  describe('text response with thinking', () => {
    it('should include reasoning_content when thinking is provided', () => {
      const res = formatResponse('deepseek-v3', 'Answer', 'my thinking process')
      expect((res.choices[0].message as any).reasoning_content).toBe('my thinking process')
    })

    it('should still include content alongside reasoning_content', () => {
      const res = formatResponse('deepseek-v3', 'Answer', 'thinking')
      expect(res.choices[0].message.content).toBe('Answer')
    })

    it('should have finish_reason "stop" even with thinking', () => {
      const res = formatResponse('deepseek-v3', 'Answer', 'thinking')
      expect(res.choices[0].finish_reason).toBe('stop')
    })
  })

  describe('tool call response', () => {
    const toolJson = '{"tool_use": {"name": "read_file", "arguments": {"path": "src/index.ts"}}}'

    it('should have finish_reason "tool_calls" when content is a tool call', () => {
      const res = formatResponse('deepseek-v3', toolJson)
      expect(res.choices[0].finish_reason).toBe('tool_calls')
    })

    it('should have content null in message for tool call', () => {
      const res = formatResponse('deepseek-v3', toolJson)
      expect(res.choices[0].message.content).toBeNull()
    })

    it('should include tool_calls array in message', () => {
      const res = formatResponse('deepseek-v3', toolJson)
      const msg = res.choices[0].message as any
      expect(Array.isArray(msg.tool_calls)).toBe(true)
      expect(msg.tool_calls).toHaveLength(1)
    })

    it('should include function name in tool_calls', () => {
      const res = formatResponse('deepseek-v3', toolJson)
      const msg = res.choices[0].message as any
      expect(msg.tool_calls[0].function.name).toBe('read_file')
    })

    it('should stringify tool call arguments', () => {
      const res = formatResponse('deepseek-v3', toolJson)
      const msg = res.choices[0].message as any
      const args = msg.tool_calls[0].function.arguments
      expect(typeof args).toBe('string')
      expect(JSON.parse(args)).toEqual({ path: 'src/index.ts' })
    })

    it('should NOT include reasoning_content when thinking is absent', () => {
      const res = formatResponse('deepseek-v3', toolJson)
      const msg = res.choices[0].message as any
      expect(msg.reasoning_content).toBeUndefined()
    })

    it('should include reasoning_content when thinking is provided with tool call', () => {
      const res = formatResponse('deepseek-v3', toolJson, 'deep thought')
      const msg = res.choices[0].message as any
      expect(msg.reasoning_content).toBe('deep thought')
    })

    it('should have both tool_calls and reasoning_content when thinking is provided', () => {
      const res = formatResponse('deepseek-v3', toolJson, 'deep thought')
      const msg = res.choices[0].message as any
      expect(Array.isArray(msg.tool_calls)).toBe(true)
      expect(msg.reasoning_content).toBe('deep thought')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseRequest
// ─────────────────────────────────────────────────────────────────────────────

describe('parseRequest', () => {
  describe('basic fields', () => {
    it('should parse model from body', () => {
      const req = parseRequest({ model: 'deepseek-v3', messages: [] })
      expect(req.model).toBe('deepseek-v3')
    })

    it('should parse stream flag (true)', () => {
      const req = parseRequest({ model: 'm', messages: [], stream: true })
      expect(req.stream).toBe(true)
    })

    it('should default stream to false when absent', () => {
      const req = parseRequest({ model: 'm', messages: [] })
      expect(req.stream).toBe(false)
    })

    it('should map body.user to conversationId', () => {
      const req = parseRequest({ model: 'm', messages: [], user: 'conv-123' })
      expect(req.conversationId).toBe('conv-123')
    })

    it('should have undefined conversationId when user is absent', () => {
      const req = parseRequest({ model: 'm', messages: [] })
      expect(req.conversationId).toBeUndefined()
    })
  })

  describe('message content normalization', () => {
    it('should preserve string content as-is', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hello' }],
      })
      expect(req.messages[0].content).toBe('hello')
    })

    it('should convert content: null to empty string', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'assistant', content: null }],
      })
      expect(req.messages[0].content).toBe('')
    })

    it('should concatenate array content blocks into a single string', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world' },
          ],
        }],
      })
      expect(req.messages[0].content).toBe('Hello world')
    })

    it('should handle array content blocks with "content" key instead of "text"', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{
          role: 'user',
          content: [{ type: 'text', content: 'fallback text' }],
        }],
      })
      expect(req.messages[0].content).toBe('fallback text')
    })

    it('should handle empty array content as empty string', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: [] }],
      })
      expect(req.messages[0].content).toBe('')
    })
  })

  describe('role: tool messages', () => {
    it('should preserve role "tool" in parsed message', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{
          role: 'tool',
          content: '{"result": "ok"}',
          tool_call_id: 'toolu_abc',
        }],
      })
      expect(req.messages[0].role).toBe('tool')
    })

    it('should preserve tool_call_id in tool messages', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{
          role: 'tool',
          content: 'result',
          tool_call_id: 'toolu_abc',
        }],
      })
      expect(req.messages[0].tool_call_id).toBe('toolu_abc')
    })

    it('should NOT include tool_call_id on non-tool messages', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(req.messages[0].tool_call_id).toBeUndefined()
    })
  })

  describe('tools injection', () => {
    it('should inject a system message when tools are provided', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { properties: { path: { type: 'string' } } },
          },
        }],
      })
      expect(req.messages[0].role).toBe('system')
      expect(req.messages[0].content).toContain('read_file')
    })

    it('should prepend system message before user messages when tools present', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ function: { name: 'shell', description: 'Run shell' } }],
      })
      expect(req.messages).toHaveLength(2)
      expect(req.messages[0].role).toBe('system')
      expect(req.messages[1].content).toBe('hi')
    })

    it('should NOT inject system message when tools array is empty', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
      })
      expect(req.messages).toHaveLength(1)
      expect(req.messages[0].role).toBe('user')
    })

    it('should support functions key as alias for tools', () => {
      const req = parseRequest({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        functions: [{ name: 'my_func', description: 'Does something' }],
      })
      expect(req.messages[0].role).toBe('system')
      expect(req.messages[0].content).toContain('my_func')
    })
  })

  describe('empty and minimal bodies', () => {
    it('should return empty messages array when messages is absent', () => {
      const req = parseRequest({ model: 'm' })
      expect(req.messages).toEqual([])
    })

    it('should handle multiple messages preserving order', () => {
      const req = parseRequest({
        model: 'm',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
        ],
      })
      expect(req.messages).toHaveLength(3)
      expect(req.messages[0].role).toBe('system')
      expect(req.messages[1].role).toBe('user')
      expect(req.messages[2].role).toBe('assistant')
    })
  })
})
