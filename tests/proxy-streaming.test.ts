import { describe, it, expect } from 'bun:test'
import {
  formatStreamChunk,
  formatStreamEnd,
  formatStreamReasoning,
  formatStreamToolCall,
  parseToolCall,
} from '../src/agent/providers/proxy/formatters/openai.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replica exata da lógica de decisão de buffering da rota openai.ts.
 * Extraída como função pura para ser testável sem Hono/Playwright.
 *
 * Retorna true quando o token acumulado DEVE ser bufferizado (pode ser tool call).
 * Retorna false quando deve ser emitido imediatamente (texto normal ou flush forçado).
 */
function shouldBuffer(accumulated: string): boolean {
  const trimmedStart = accumulated.trimStart()
  const startsLikeJson = trimmedStart.startsWith('{') || trimmedStart.startsWith('```')
  const containsToolMarker =
    accumulated.includes('"tool_use"') ||
    accumulated.includes('DSML') ||
    accumulated.includes('<tool_call>')

  return accumulated.length < 2000 && (startsLikeJson || containsToolMarker)
}

/** Parseia um chunk SSE no formato "data: {...}\n\n" */
function parseSseChunk(raw: string): any {
  const line = raw.trim()
  expect(line.startsWith('data: ')).toBe(true)
  return JSON.parse(line.slice('data: '.length))
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldBuffer — lógica de decisão de buffering
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldBuffer (streaming buffering decision logic)', () => {

  // ── 1. Texto normal — flush imediato ──────────────────────────────────────
  describe('text responses — should NOT buffer', () => {
    it('should return false for normal text starting with a word', () => {
      expect(shouldBuffer("Hello, I'll help you with that.")).toBe(false)
    })

    it('should return false for single letter start', () => {
      expect(shouldBuffer('I')).toBe(false)
    })

    it('should return false for markdown heading', () => {
      expect(shouldBuffer('# Hello World')).toBe(false)
    })

    it('should return false for markdown bold text', () => {
      expect(shouldBuffer('**Important:** this is a note')).toBe(false)
    })

    it('should return false for text starting with a number', () => {
      expect(shouldBuffer('1. First item in the list')).toBe(false)
    })

    it('should return false for text starting with a dash (list item)', () => {
      expect(shouldBuffer('- list item here')).toBe(false)
    })

    it('should return false for text starting with whitespace then a word', () => {
      expect(shouldBuffer('  Sure, let me help.')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(shouldBuffer('')).toBe(false)
    })
  })

  // ── 2. Começa com { — bufferar (pode ser tool call) ───────────────────────
  describe('JSON-like start — should buffer', () => {
    it('should return true when accumulated starts with {', () => {
      expect(shouldBuffer('{')).toBe(true)
    })

    it('should return true when accumulated starts with { and has tool_use content', () => {
      expect(shouldBuffer('{"tool_use": {"name": "read_file"')).toBe(true)
    })

    it('should return true when accumulated starts with { but is generic JSON (ambiguous)', () => {
      // Ainda não sabemos se é tool call — bufferar até ter certeza
      expect(shouldBuffer('{"key": "value"}')).toBe(true)
    })

    it('should return true when accumulated starts with whitespace then {', () => {
      expect(shouldBuffer('  {"tool_use"')).toBe(true)
    })
  })

  // ── 3. Começa com ``` — bufferar ──────────────────────────────────────────
  describe('code fence start — should buffer', () => {
    it('should return true when accumulated starts with ```', () => {
      expect(shouldBuffer('```')).toBe(true)
    })

    it('should return true when accumulated starts with ```json', () => {
      expect(shouldBuffer('```json\n{"tool_use"')).toBe(true)
    })

    it('should return true when accumulated starts with ```text', () => {
      expect(shouldBuffer('```text\n{"tool_use"')).toBe(true)
    })

    it('should return true when accumulated starts with whitespace then ```', () => {
      expect(shouldBuffer('  ```json\n{')).toBe(true)
    })
  })

  // ── 4. Contém marcadores de tool call — bufferar ──────────────────────────
  describe('tool markers in content — should buffer', () => {
    it('should return true when accumulated contains "tool_use"', () => {
      expect(shouldBuffer('some text {"tool_use": {"name"')).toBe(true)
    })

    it('should return true when accumulated contains DSML marker', () => {
      expect(shouldBuffer('<||DSML||invoke name="read_file">')).toBe(true)
    })

    it('should return true when accumulated contains <tool_call> tag', () => {
      expect(shouldBuffer('<tool_call>\n{"tool_use"')).toBe(true)
    })

    it('should return true when text starts with letter but contains "tool_use" later', () => {
      // Texto que começa normal mas depois tem tool_use — deve bufferar
      expect(shouldBuffer('Let me {"tool_use": {"name"')).toBe(true)
    })
  })

  // ── 5. Flush forçado quando > 2000 chars ──────────────────────────────────
  describe('forced flush when length >= 2000 — should NOT buffer', () => {
    it('should return false when accumulated starts with { but length >= 2000', () => {
      const longJson = '{' + 'x'.repeat(2000)
      expect(shouldBuffer(longJson)).toBe(false)
    })

    it('should return false when accumulated contains tool_use but length >= 2000', () => {
      const longText = '"tool_use"' + 'x'.repeat(2000)
      expect(shouldBuffer(longText)).toBe(false)
    })

    it('should return false when accumulated starts with ``` but length >= 2000', () => {
      const longFence = '```' + 'x'.repeat(2000)
      expect(shouldBuffer(longFence)).toBe(false)
    })

    it('should return true when accumulated starts with { and length is exactly 1999', () => {
      const almostLong = '{' + 'x'.repeat(1998)
      expect(almostLong.length).toBe(1999)
      expect(shouldBuffer(almostLong)).toBe(true)
    })

    it('should return false when accumulated starts with { and length is exactly 2000', () => {
      const exactLimit = '{' + 'x'.repeat(1999)
      expect(exactLimit.length).toBe(2000)
      expect(shouldBuffer(exactLimit)).toBe(false)
    })
  })

  // ── 6. Casos de borda adicionais ──────────────────────────────────────────
  describe('edge cases', () => {
    it('should return false for text starting with a question mark', () => {
      expect(shouldBuffer('? What do you mean?')).toBe(false)
    })

    it('should return false for text starting with a newline then a word', () => {
      expect(shouldBuffer('\nSure, here is the answer.')).toBe(false)
    })

    it('should return true for text starting with newline then {', () => {
      expect(shouldBuffer('\n{"tool_use"')).toBe(true)
    })

    it('should return false for JSON array (not an object)', () => {
      // Arrays não começam com { — não são tool calls
      expect(shouldBuffer('[1, 2, 3]')).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseToolCall — delegação para parseToolResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('parseToolCall (openai formatter)', () => {

  // ── 1. Happy path ──────────────────────────────────────────────────────────
  describe('valid tool call inputs', () => {
    it('should parse clean tool_use JSON and return name + arguments', () => {
      const input = '{"tool_use": {"name": "read_file", "arguments": {"path": "src/index.ts"}}}'
      const result = parseToolCall(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_file')
      expect(result!.arguments).toEqual({ path: 'src/index.ts' })
    })

    it('should return an id starting with "toolu_"', () => {
      const input = '{"tool_use": {"name": "shell", "arguments": {"command": "ls"}}}'
      const result = parseToolCall(input)
      expect(result!.id).toMatch(/^toolu_/)
    })

    it('should parse tool_use wrapped in ```json code fence (parser now supports fences)', () => {
      const input = '```json\n{"tool_use": {"name": "grep", "arguments": {"pattern": "TODO"}}}\n```'
      const result = parseToolCall(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('grep')
      expect(result!.arguments).toEqual({ pattern: 'TODO' })
    })

    it('should parse tool_use inside <tool_call> XML tags', () => {
      const input = '<tool_call>\n{"tool_use": {"name": "write_file", "arguments": {"path": "out.ts", "content": "x"}}}\n</tool_call>'
      const result = parseToolCall(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('write_file')
    })

    it('should parse DSML format', () => {
      const input = '<||DSML||invoke name="shell"><||DSML||parameter name="command">"bun test"</||DSML||parameter>'
      const result = parseToolCall(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
    })

    it('should parse tool_use with empty arguments object', () => {
      const input = '{"tool_use": {"name": "git_status", "arguments": {}}}'
      const result = parseToolCall(input)
      expect(result).not.toBeNull()
      expect(result!.arguments).toEqual({})
    })
  })

  // ── 2. Deve retornar null para texto normal ────────────────────────────────
  describe('non-tool-call inputs — should return null', () => {
    it('should return null for plain text response', () => {
      expect(parseToolCall('Hello, I can help you with that.')).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseToolCall('')).toBeNull()
    })

    it('should return null for JSON that is not a tool call', () => {
      expect(parseToolCall('{"name": "John", "age": 30}')).toBeNull()
    })

    it('should return null for markdown code block with regular code', () => {
      expect(parseToolCall('```typescript\nconst x = 1\n```')).toBeNull()
    })

    it('should return null for tool_use JSON missing the name field', () => {
      expect(parseToolCall('{"tool_use": {"arguments": {"path": "x"}}}')).toBeNull()
    })

    it('should return null for text longer than 10KB (performance guard)', () => {
      const longText = 'x'.repeat(10 * 1024 + 1)
      expect(parseToolCall(longText)).toBeNull()
    })
  })

  // ── 3. Comportamento do parser com JSON embutido em texto ────────────────
  describe('parser behavior with embedded JSON', () => {
    it('should return null when tool_use JSON is inside a code fence within a long explanation (strict parser rejects fences)', () => {
      // O parser estrito rejeita code fences — isso previne falsos positivos
      // quando o modelo está explicando como usar tools
      const longExplanation = 'Here is an example of how to call a tool:\n\n'
        + '```json\n{"tool_use": {"name": "read_file", "arguments": {"path": "x"}}}\n```\n\n'
        + 'This is just an example. You should not actually call this tool right now. '
        + 'The format above shows the structure you need to follow when making tool calls.'
      const result = parseToolCall(longExplanation)
      expect(result).toBeNull()
    })

    it('should return null for plain text with tool_use mentioned in prose (no JSON structure)', () => {
      // Texto que menciona "tool_use" mas não tem JSON válido
      const prose = 'The tool_use field is used to indicate a tool call in the protocol.'
      expect(parseToolCall(prose)).toBeNull()
    })

    it('should return null for text > 10KB even if it contains tool_use JSON', () => {
      // Guard de performance: respostas > 10KB são tratadas como texto normal
      const bigText = '{"tool_use": {"name": "read_file", "arguments": {}}}' + 'x'.repeat(10 * 1024)
      expect(parseToolCall(bigText)).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatStreamEnd — terminador SSE
// ─────────────────────────────────────────────────────────────────────────────

describe('formatStreamEnd', () => {
  it('should return exactly "data: [DONE]\\n\\n"', () => {
    expect(formatStreamEnd()).toBe('data: [DONE]\n\n')
  })

  it('should end with double newline (SSE terminator)', () => {
    expect(formatStreamEnd().endsWith('\n\n')).toBe(true)
  })

  it('should start with "data: "', () => {
    expect(formatStreamEnd().startsWith('data: ')).toBe(true)
  })

  it('should be deterministic — same output on every call', () => {
    expect(formatStreamEnd()).toBe(formatStreamEnd())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SSE output format — formatStreamChunk e formatStreamReasoning
// ─────────────────────────────────────────────────────────────────────────────

describe('SSE output format', () => {

  describe('formatStreamChunk SSE structure', () => {
    it('should produce valid JSON after "data: " prefix', () => {
      const raw = formatStreamChunk('hello', 'deepseek-v3')
      const line = raw.trim()
      expect(() => JSON.parse(line.slice('data: '.length))).not.toThrow()
    })

    it('should have exactly one newline pair at the end (\\n\\n)', () => {
      const raw = formatStreamChunk('hello', 'deepseek-v3')
      expect(raw.endsWith('\n\n')).toBe(true)
      // Não deve ter mais de dois newlines no final
      expect(raw.endsWith('\n\n\n')).toBe(false)
    })

    it('should include the token in delta.content', () => {
      const chunk = parseSseChunk(formatStreamChunk('world', 'model'))
      expect(chunk.choices[0].delta.content).toBe('world')
    })

    it('should handle token with special characters (quotes, backslashes)', () => {
      const token = 'He said "hello" and she said \'bye\''
      const chunk = parseSseChunk(formatStreamChunk(token, 'model'))
      expect(chunk.choices[0].delta.content).toBe(token)
    })

    it('should handle token with newlines', () => {
      const token = 'line1\nline2\nline3'
      const chunk = parseSseChunk(formatStreamChunk(token, 'model'))
      expect(chunk.choices[0].delta.content).toBe(token)
    })

    it('should handle empty token string', () => {
      const chunk = parseSseChunk(formatStreamChunk('', 'model'))
      expect(chunk.choices[0].delta.content).toBe('')
    })
  })

  describe('formatStreamReasoning SSE structure', () => {
    it('should produce valid JSON after "data: " prefix', () => {
      const raw = formatStreamReasoning('thinking...', 'deepseek-r1')
      expect(() => JSON.parse(raw.trim().slice('data: '.length))).not.toThrow()
    })

    it('should include reasoning_content in delta (not content)', () => {
      const chunk = parseSseChunk(formatStreamReasoning('my thought', 'model'))
      expect(chunk.choices[0].delta.reasoning_content).toBe('my thought')
      expect(chunk.choices[0].delta.content).toBeUndefined()
    })

    it('should end with double newline', () => {
      expect(formatStreamReasoning('x', 'model').endsWith('\n\n')).toBe(true)
    })
  })

  describe('formatStreamToolCall SSE structure', () => {
    const toolCall = { id: 'toolu_abc', name: 'read_file', arguments: { path: 'src/app.ts' } }

    it('should produce valid JSON after "data: " prefix', () => {
      const raw = formatStreamToolCall(toolCall, 'model')
      expect(() => JSON.parse(raw.trim().slice('data: '.length))).not.toThrow()
    })

    it('should have finish_reason "tool_calls"', () => {
      const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'model'))
      expect(chunk.choices[0].finish_reason).toBe('tool_calls')
    })

    it('should include function.name in tool_calls delta', () => {
      const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'model'))
      expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe('read_file')
    })

    it('should stringify arguments as a JSON string', () => {
      const chunk = parseSseChunk(formatStreamToolCall(toolCall, 'model'))
      const args = chunk.choices[0].delta.tool_calls[0].function.arguments
      expect(typeof args).toBe('string')
      expect(JSON.parse(args)).toEqual({ path: 'src/app.ts' })
    })

    it('should end with double newline', () => {
      expect(formatStreamToolCall(toolCall, 'model').endsWith('\n\n')).toBe(true)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Simulação do loop de streaming — comportamento end-to-end da lógica
// ─────────────────────────────────────────────────────────────────────────────

describe('streaming loop behavior simulation', () => {
  /**
   * Simula o loop de streaming da rota openai.ts sem Hono/Playwright.
   * Recebe tokens e retorna os chunks SSE que teriam sido emitidos.
   */
  function simulateStreamingLoop(
    tokens: string[],
    model = 'deepseek-v3',
  ): { chunks: string[]; endChunk: string } {
    const chunks: string[] = []
    let accumulated = ''

    for (const token of tokens) {
      accumulated += token

      const trimmedStart = accumulated.trimStart()
      const startsLikeJson = trimmedStart.startsWith('{') || trimmedStart.startsWith('```')
      const containsToolMarker =
        accumulated.includes('"tool_use"') ||
        accumulated.includes('DSML') ||
        accumulated.includes('<tool_call>')

      const couldBeTool = accumulated.length < 2000 && (startsLikeJson || containsToolMarker)

      if (!couldBeTool) {
        chunks.push(formatStreamChunk(accumulated, model))
        accumulated = ''
      } else if (accumulated.length >= 2000) {
        chunks.push(formatStreamChunk(accumulated, model))
        accumulated = ''
      }
    }

    // Simula o evento done
    const toolCall = parseToolCall(accumulated)
    if (toolCall) {
      chunks.push(formatStreamToolCall(toolCall, model))
    } else if (accumulated) {
      chunks.push(formatStreamChunk(accumulated, model))
    }

    const endChunk = formatStreamEnd()
    return { chunks, endChunk }
  }

  // ── 1. Texto normal — flush imediato a cada token ─────────────────────────
  it('should emit each text token immediately (no buffering)', () => {
    const tokens = ['Hello', ', ', 'world', '!']
    const { chunks, endChunk } = simulateStreamingLoop(tokens)

    // Cada token deve gerar um chunk imediato
    expect(chunks).toHaveLength(4)
    expect(parseSseChunk(chunks[0]!).choices[0].delta.content).toBe('Hello')
    expect(parseSseChunk(chunks[1]!).choices[0].delta.content).toBe(', ')
    expect(parseSseChunk(chunks[2]!).choices[0].delta.content).toBe('world')
    expect(parseSseChunk(chunks[3]!).choices[0].delta.content).toBe('!')
    expect(endChunk).toBe('data: [DONE]\n\n')
  })

  // ── 2. Tool call completa — bufferiza tudo, emite como tool_calls no done ──
  it('should buffer entire tool call and emit as tool_calls delta on done', () => {
    const toolJson = '{"tool_use": {"name": "read_file", "arguments": {"path": "src/app.ts"}}}'
    // Simula chegada em tokens pequenos
    const tokens = toolJson.split('').reduce<string[]>((acc, ch, i) => {
      if (i % 10 === 0) acc.push(toolJson.slice(i, i + 10))
      return acc
    }, [])

    const { chunks } = simulateStreamingLoop(tokens)

    // Deve ter exatamente 1 chunk — o tool_calls delta
    expect(chunks).toHaveLength(1)
    const chunk = parseSseChunk(chunks[0]!)
    expect(chunk.choices[0].finish_reason).toBe('tool_calls')
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe('read_file')
  })

  // ── 3. Texto > 2000 chars que começa com { — flush forçado ───────────────
  it('should force-flush when buffer exceeds 2000 chars even if starts with {', () => {
    // Começa com { mas é texto longo demais para ser tool call
    const longContent = '{' + 'x'.repeat(2500)
    const tokens = [longContent]
    const { chunks } = simulateStreamingLoop(tokens)

    // Deve ter emitido como texto (flush forçado), não como tool call
    expect(chunks).toHaveLength(1)
    const chunk = parseSseChunk(chunks[0]!)
    // finish_reason null = texto normal (não tool_calls)
    expect(chunk.choices[0].finish_reason).toBeNull()
    expect(chunk.choices[0].delta.content).toContain('{')
  })

  // ── 4. Resposta vazia — apenas [DONE] ─────────────────────────────────────
  it('should emit only [DONE] when no tokens are produced', () => {
    const { chunks, endChunk } = simulateStreamingLoop([])
    expect(chunks).toHaveLength(0)
    expect(endChunk).toBe('data: [DONE]\n\n')
  })

  // ── 5. Token único de texto — flush imediato ──────────────────────────────
  it('should flush immediately for a single text token', () => {
    const { chunks } = simulateStreamingLoop(['Sure!'])
    expect(chunks).toHaveLength(1)
    expect(parseSseChunk(chunks[0]!).choices[0].delta.content).toBe('Sure!')
  })

  // ── 6. Tokens com DSML — bufferiza até done ───────────────────────────────
  it('should buffer tokens containing DSML marker', () => {
    const tokens = ['<||DSML||invoke name="shell">', '<||DSML||parameter name="command">"ls"</||DSML||parameter>']
    const { chunks } = simulateStreamingLoop(tokens)

    // Deve ter bufferizado e emitido como tool call no done
    expect(chunks).toHaveLength(1)
    const chunk = parseSseChunk(chunks[0]!)
    expect(chunk.choices[0].finish_reason).toBe('tool_calls')
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe('shell')
  })

  // ── 7. Tokens com <tool_call> — bufferiza até done ────────────────────────
  it('should buffer tokens containing <tool_call> marker', () => {
    const toolCallContent = '<tool_call>\n{"tool_use": {"name": "grep", "arguments": {"pattern": "TODO"}}}\n</tool_call>'
    const tokens = [toolCallContent]
    const { chunks } = simulateStreamingLoop(tokens)

    expect(chunks).toHaveLength(1)
    const chunk = parseSseChunk(chunks[0]!)
    expect(chunk.choices[0].finish_reason).toBe('tool_calls')
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe('grep')
  })

  // ── 8. Markdown heading — flush imediato ─────────────────────────────────
  it('should flush immediately for markdown heading token', () => {
    const tokens = ['# ', 'My ', 'Title']
    const { chunks } = simulateStreamingLoop(tokens)

    // Primeiro token "# " não começa com { ou ``` — flush imediato
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const firstContent = parseSseChunk(chunks[0]!).choices[0].delta.content
    expect(firstContent).toBe('# ')
  })

  // ── 9. Todos os chunks SSE têm formato correto ────────────────────────────
  it('should produce well-formed SSE chunks for all emitted tokens', () => {
    const tokens = ['The ', 'answer ', 'is ', '42.']
    const { chunks, endChunk } = simulateStreamingLoop(tokens)

    for (const chunk of chunks) {
      expect(chunk.startsWith('data: ')).toBe(true)
      expect(chunk.endsWith('\n\n')).toBe(true)
      // Deve ser JSON válido
      expect(() => JSON.parse(chunk.trim().slice('data: '.length))).not.toThrow()
    }
    expect(endChunk).toBe('data: [DONE]\n\n')
  })
})
