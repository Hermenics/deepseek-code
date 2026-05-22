import { describe, it, expect } from 'bun:test'
import { parseToolResponse, injectToolPrompt } from '../src/agent/providers/proxy/tools/prompt-emulation.js'

// ─────────────────────────────────────────────────────────────────────────────
// parseToolResponse — Parser de tool calls do DeepSeek via OAuth proxy
// ─────────────────────────────────────────────────────────────────────────────

describe('parseToolResponse', () => {

  // ── 1. Clean JSON (ideal case) ─────────────────────────────────────────────
  describe('clean JSON format', () => {
    it('should parse a clean tool_use JSON with no surrounding text', () => {
      const input = '{"tool_use": {"name": "read_file", "arguments": {"path": "src/index.ts"}}}'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_file')
      expect(result!.arguments).toEqual({ path: 'src/index.ts' })
      expect(result!.id).toMatch(/^toolu_/)
    })

    it('should parse tool_use with complex nested arguments', () => {
      const input = '{"tool_use": {"name": "write_file", "arguments": {"path": "hello.ts", "content": "console.log(\\"hello\\")"}}}'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('write_file')
      expect(result!.arguments.path).toBe('hello.ts')
      expect(result!.arguments.content).toBe('console.log("hello")')
    })

    it('should parse tool_use with empty arguments', () => {
      const input = '{"tool_use": {"name": "git", "arguments": {}}}'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('git')
      expect(result!.arguments).toEqual({})
    })
  })

  // ── 2. Wrapped in markdown code fences (agora suportado após fix) ───────────
  describe('markdown code fence wrapper', () => {
    it('should parse tool_use inside ```json fence', () => {
      const input = '```json\n{"tool_use": {"name": "shell", "arguments": {"command": "bun test"}}}\n```'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
      expect(result!.arguments).toEqual({ command: 'bun test' })
    })

    it('should parse tool_use inside plain ``` fence', () => {
      const input = '```\n{"tool_use": {"name": "grep", "arguments": {"pattern": "TODO", "path": "src"}}}\n```'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('grep')
      expect(result!.arguments).toEqual({ pattern: 'TODO', path: 'src' })
    })

    it('should parse tool_use inside ```text fence', () => {
      const input = '```text\n{"tool_use": {"name": "read_folder", "arguments": {"path": "."}}}\n```'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_folder')
      expect(result!.arguments).toEqual({ path: '.' })
    })
  })

  // ── 3. Text before/after the JSON ─────────────────────────────────────────
  describe('text surrounding the JSON', () => {
    it('should parse when model adds text before the JSON', () => {
      const input = 'I\'ll read that file for you.\n{"tool_use": {"name": "read_file", "arguments": {"path": "package.json"}}}'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_file')
      expect(result!.arguments.path).toBe('package.json')
    })

    it('should parse when model adds text after the JSON', () => {
      const input = '{"tool_use": {"name": "shell", "arguments": {"command": "ls"}}}\n\nThis will list the files.'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
      expect(result!.arguments.command).toBe('ls')
    })

    it('should parse when model adds text both before and after', () => {
      const input = 'Let me check that.\n{"tool_use": {"name": "glob", "arguments": {"pattern": "**/*.ts"}}}\nDone.'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('glob')
      expect(result!.arguments.pattern).toBe('**/*.ts')
    })
  })

  // ── 4. <tool_call> XML wrapper ─────────────────────────────────────────────
  describe('<tool_call> XML wrapper', () => {
    it('should parse JSON inside <tool_call> tags', () => {
      const input = '<tool_call>\n{"tool_use": {"name": "read_file", "arguments": {"path": "src/app.ts"}}}\n</tool_call>'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_file')
      expect(result!.arguments.path).toBe('src/app.ts')
    })

    it('should parse <tool_call> with extra whitespace', () => {
      const input = '<tool_call>  \n  {"tool_use": {"name": "shell", "arguments": {"command": "npm run build"}}}  \n  </tool_call>'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
    })
  })

  // ── 5. DSML format (DeepSeek native) ───────────────────────────────────────
  describe('DSML format', () => {
    it('should parse DSML invoke with parameters', () => {
      const input = '||DSML||invoke name="read_file"><||DSML||parameter name="path">src/index.ts</||DSML||parameter>'
      // The regex expects <|| not just ||
      const input2 = '<||DSML||invoke name="read_file"><||DSML||parameter name="path">src/index.ts</||DSML||parameter>'
      const result = parseToolResponse(input2)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_file')
      expect(result!.arguments.path).toBe('src/index.ts')
    })

    it('should parse DSML with JSON parameter value', () => {
      const input = '<||DSML||invoke name="shell"><||DSML||parameter name="command">"bun test"</||DSML||parameter>'
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
      expect(result!.arguments.command).toBe('bun test')
    })
  })

  // ── 6. Direct format (no tool_use wrapper) ─────────────────────────────────
  describe('direct format without tool_use wrapper', () => {
    it('should return null for {"name": ..., "arguments": ...} format', () => {
      const input = '{"name": "read_file", "arguments": {"path": "tsconfig.json"}}'
      expect(parseToolResponse(input)).toBeNull()
    })
  })

  // ── 7. Whitespace variations ───────────────────────────────────────────────
  describe('whitespace handling', () => {
    it('should parse with leading/trailing whitespace', () => {
      const input = '   \n  {"tool_use": {"name": "shell", "arguments": {"command": "pwd"}}}  \n  '
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('shell')
    })

    it('should parse with internal newlines in JSON', () => {
      const input = `{
  "tool_use": {
    "name": "write_file",
    "arguments": {
      "path": "test.ts",
      "content": "export const x = 1"
    }
  }
}`
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('write_file')
      expect(result!.arguments.path).toBe('test.ts')
    })
  })

  // ── 8. Edge cases — should return null ─────────────────────────────────────
  describe('non-tool responses (should return null)', () => {
    it('should return null for plain text', () => {
      const input = 'This is just a normal response about JavaScript promises.'
      expect(parseToolResponse(input)).toBeNull()
    })

    it('should return null for code blocks that are not tool calls', () => {
      const input = '```typescript\nconst x = 1\nconsole.log(x)\n```'
      expect(parseToolResponse(input)).toBeNull()
    })

    it('should return null for JSON that is not a tool call', () => {
      const input = '{"name": "John", "age": 30}'
      // This has "name" but no "arguments" object
      expect(parseToolResponse(input)).toBeNull()
    })

    it('should return null for empty string', () => {
      expect(parseToolResponse('')).toBeNull()
    })

    it('should return null for JSON with tool_use but missing name', () => {
      const input = '{"tool_use": {"arguments": {"path": "x"}}}'
      expect(parseToolResponse(input)).toBeNull()
    })
  })

  // ── 9. Malformed JSON recovery (não suportado) ────────────────────────────
  describe('malformed JSON recovery', () => {
    it('should return null for trailing comma in arguments', () => {
      const input = '{"tool_use": {"name": "shell", "arguments": {"command": "ls",}}}'
      expect(parseToolResponse(input)).toBeNull()
    })
  })

  // ── 10. Multi-line content in arguments ────────────────────────────────────
  describe('multi-line content', () => {
    it('should handle newlines inside argument values', () => {
      const content = 'line1\\nline2\\nline3'
      const input = `{"tool_use": {"name": "write_file", "arguments": {"path": "test.txt", "content": "${content}"}}}`
      const result = parseToolResponse(input)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('write_file')
      expect(result!.arguments.content).toBe('line1\nline2\nline3')
    })
  })

  // ── 11. Allowlist validation ────────────────────────────────────────────────
  describe('allowedTools allowlist', () => {
    it('should return null when tool is not in allowlist', () => {
      const input = '{"tool_use": {"name": "shell", "arguments": {"command": "ls"}}}'
      const allowed = new Set(['read_file'])
      expect(parseToolResponse(input, allowed)).toBeNull()
    })

    it('should parse when tool is in allowlist', () => {
      const input = '{"tool_use": {"name": "read_file", "arguments": {"path": "package.json"}}}'
      const allowed = new Set(['read_file'])
      const result = parseToolResponse(input, allowed)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('read_file')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// injectToolPrompt — Injeção do prompt de tools nas mensagens
// ─────────────────────────────────────────────────────────────────────────────

describe('injectToolPrompt', () => {
  it('should prepend a system message with tool definitions', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
    ]
    const tools = [
      { name: 'read_file', description: 'Read a file', input_schema: { properties: { path: { type: 'string', description: 'File path' } } } },
    ]
    const result = injectToolPrompt(messages, tools)
    expect(result).toHaveLength(2)
    expect(result[0]!.role).toBe('system')
    expect(result[0]!.content).toContain('read_file')
    expect(result[0]!.content).toContain('TOOL CALLING PROTOCOL')
    expect(result[1]!.content).toBe('Hello')
  })

  it('should return messages unchanged when tools array is empty', () => {
    const messages = [{ role: 'user' as const, content: 'Hi' }]
    const result = injectToolPrompt(messages, [])
    expect(result).toEqual(messages)
  })

  it('should include all tool names in the prompt', () => {
    const tools = [
      { name: 'read_file', description: 'Read' },
      { name: 'shell', description: 'Run command' },
      { name: 'grep', description: 'Search' },
    ]
    const result = injectToolPrompt([{ role: 'user' as const, content: 'x' }], tools)
    expect(result[0]!.content).toContain('read_file')
    expect(result[0]!.content).toContain('shell')
    expect(result[0]!.content).toContain('grep')
  })

  it('should include practical examples in the prompt', () => {
    const tools = [{ name: 'read_file', description: 'Read a file' }]
    const result = injectToolPrompt([{ role: 'user' as const, content: 'x' }], tools)
    // The new prompt includes practical examples
    expect(result[0]!.content).toContain('Example 1')
    expect(result[0]!.content).toContain('WRONG')
  })
})
