import type { ChatMessage } from '../types/index.js'

export interface ToolDef {
  name: string
  description?: string
  input_schema?: any
}

const TOOL_PROMPT = `# TOOL CALLING PROTOCOL

You have access to tools. When you decide to use a tool, your ENTIRE response must be ONLY the JSON below — nothing else.

## FORMAT (mandatory)

{"tool_use": {"name": "TOOL_NAME", "arguments": {"param1": "value1"}}}

## ABSOLUTE RULES

1. Your response is EITHER a tool call OR normal text. NEVER both.
2. When calling a tool: output ONLY the raw JSON. No text before. No text after. No markdown fences. No explanation.
3. When NOT calling a tool: respond normally with text. Never include the JSON format in a text response.
4. Call exactly ONE tool per response. After you receive the result, you may call another tool or respond with text.
5. NEVER wrap the JSON in \`\`\`json, \`\`\`text, or any code block.
6. NEVER prefix with "I'll use..." or "Let me..." — just output the JSON directly.

## EXAMPLES

### Example 1: Reading a file
User: "Show me the contents of src/index.ts"

Your response (the ENTIRE response, nothing else):
{"tool_use": {"name": "read_file", "arguments": {"path": "src/index.ts"}}}

### Example 2: Running a shell command
User: "Run the tests"

Your response (the ENTIRE response, nothing else):
{"tool_use": {"name": "shell", "arguments": {"command": "bun test"}}}

### Example 3: Searching for code
User: "Find where handleSubmit is defined"

Your response (the ENTIRE response, nothing else):
{"tool_use": {"name": "grep", "arguments": {"pattern": "function handleSubmit", "path": "src", "include": "*.ts"}}}

### Example 4: Writing a file
User: "Create a hello world file"

Your response (the ENTIRE response, nothing else):
{"tool_use": {"name": "write_file", "arguments": {"path": "hello.ts", "content": "console.log('hello world')"}}}

### Example 5: Exploring a directory
User: "What files are in the src folder?"

Your response (the ENTIRE response, nothing else):
{"tool_use": {"name": "read_folder", "arguments": {"path": "src"}}}

### Example 6: Normal text response (NO tool needed)
User: "Explain what a Promise is in JavaScript"

Your response:
A Promise is an object representing the eventual completion or failure of an asynchronous operation...

## WRONG (never do this):

❌ "I'll read the file for you: {"tool_use": ...}"
❌ "\`\`\`json\n{"tool_use": ...}\n\`\`\`"
❌ "Let me check that.\n{"tool_use": ...}"
❌ Calling multiple tools in one response

## AVAILABLE TOOLS

`

export function injectToolPrompt(messages: ChatMessage[], tools: ToolDef[]): ChatMessage[] {
  if (!tools || tools.length === 0) return messages

  const toolDescriptions = tools.map((t) => {
    const params = t.input_schema?.properties
      ? Object.entries(t.input_schema.properties)
          .map(([k, v]: [string, any]) => `    - ${k}: ${v.description || v.type || 'any'}`)
          .join('\n')
      : '    (no parameters)'
    return `- **${t.name}**: ${t.description || 'No description'}\n  Parameters:\n${params}`
  }).join('\n\n')

  const systemMsg: ChatMessage = {
    role: 'system',
    content: TOOL_PROMPT + toolDescriptions,
  }

  return [systemMsg, ...messages]
}

export function parseToolResponse(
  text: string,
  allowedTools?: ReadonlySet<string>,
): { name: string; id: string; arguments: any } | null {
  if (text.length > 10 * 1024) return null

  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('```')) return null

  const makeResult = (parsed: unknown): { name: string; id: string; arguments: any } | null => {
    const validated = validateToolCall(parsed)
    if (!validated) return null
    if (allowedTools && !allowedTools.has(validated.name)) return null
    return {
      name: validated.name,
      id: `toolu_${Date.now().toString(36)}`,
      arguments: validated.arguments,
    }
  }

  const dsmlInvoke = trimmed.match(/<\|{2}DSML\|{2}invoke\s+name="([^"]+)">/)
  if (dsmlInvoke) {
    const name = dsmlInvoke[1]!
    if (allowedTools && !allowedTools.has(name)) return null

    const args: Record<string, unknown> = {}
    const paramRe = /<\|{2}DSML\|{2}parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|{2}DSML\|{2}parameter>/g
    let m
    while ((m = paramRe.exec(trimmed)) !== null) {
      try { args[m[1]!] = JSON.parse(m[2]!) } catch { args[m[1]!] = m[2]! }
    }

    return { name, id: `toolu_${Date.now().toString(36)}`, arguments: args }
  }

  const toolCallTag = trimmed.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/)
  if (toolCallTag) {
    const wrappedJson = extractBalancedJson(toolCallTag[1]!.trim())
    if (!wrappedJson) return null
    try {
      return makeResult(JSON.parse(wrappedJson))
    } catch {
      return null
    }
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return makeResult(JSON.parse(trimmed))
    } catch {
      return null
    }
  }

  const jsonStartIdx = trimmed.indexOf('{"tool_use"')
  if (jsonStartIdx >= 0) {
    // Reject if there's too much text before the JSON (likely an explanation, not a prefix)
    // Short prefixes like "Let me check.\n" are ok (< 200 chars)
    // Long text before means the model is explaining, not calling a tool
    const prefix = trimmed.slice(0, jsonStartIdx)
    if (prefix.length > 200) return null
    // Also reject if the prefix contains code fence markers (model is showing an example)
    if (prefix.includes('```')) return null

    const extracted = extractBalancedJson(trimmed.slice(jsonStartIdx))
    if (!extracted) return null
    try {
      return makeResult(JSON.parse(extracted))
    } catch {
      return null
    }
  }

  return null
}

function validateToolCall(parsed: any): { name: string; arguments: Record<string, unknown> } | null {
  if (!parsed || typeof parsed !== 'object') return null
  const toolUse = parsed.tool_use
  if (!toolUse || typeof toolUse !== 'object' || Array.isArray(toolUse)) return null
  if (typeof toolUse.name !== 'string' || toolUse.name.length === 0) return null
  if (toolUse.arguments !== undefined && (typeof toolUse.arguments !== 'object' || toolUse.arguments === null || Array.isArray(toolUse.arguments))) return null
  return { name: toolUse.name, arguments: toolUse.arguments || {} }
}

/** Extract a balanced JSON object from text starting at the first { */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"' && !escape) { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
