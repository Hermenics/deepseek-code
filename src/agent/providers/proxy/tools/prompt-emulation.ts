import type { ChatMessage } from '../types/index.js'
import { robustParseJSON } from '../services/robust-json.js'
import { resolveToolName } from '../services/output-sanitizer.js'

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
4. You may call multiple tools in a single response when they are independent of each other. For write operations that depend on each other, call them sequentially. After you receive results, you may call additional tools or respond with text.
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

export function parseToolResponses(
  text: string,
  allowedTools?: ReadonlySet<string>,
): Array<{ name: string; id: string; arguments: any }> {
  if (text.length > 10 * 1024) return []

  const trimmed = text.trim()
  if (!trimmed) return []

  const makeResult = (parsed: unknown, allowDirectFormat = false): { name: string; id: string; arguments: any } | null => {
    const validated = validateToolCall(parsed, allowDirectFormat)
    if (!validated) return null

    // Fuzzy tool name resolution: ReadFile → read_file, SHELL → shell, etc.
    const knownToolList = allowedTools ? [...allowedTools] : []
    const resolved = knownToolList.length > 0
      ? resolveToolName(validated.name, knownToolList) || validated.name
      : validated.name

    if (allowedTools && !allowedTools.has(resolved)) return null
    return {
      name: resolved,
      id: `toolu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      arguments: validated.arguments,
    }
  }

  const results: Array<{ name: string; id: string; arguments: any }> = []

  const pushIfValid = (parsed: unknown, allowDirectFormat = false) => {
    const result = makeResult(parsed, allowDirectFormat)
    if (result) results.push(result)
  }

  const source = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json|text|typescript|js)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    : trimmed

  // Normalize Unicode variants in tags before parsing (from ds-free-api)
  // DeepSeek sometimes outputs ｜ (U+FF5C) instead of | and ▁ (U+2581) instead of _
  const normalized = source
    .replace(/｜/g, '|')  // full-width pipe → ASCII pipe
    .replace(/▁/g, '_')  // lower one eighth block → underscore

  // ── DSML format: <|DSML|invoke name="..."> (native DeepSeek format)
  const dsmlInvoke = normalized.match(/<\|{1,2}DSML\|{1,2}invoke\s+name="([^"]+)">/i)
  if (dsmlInvoke) {
    const name = dsmlInvoke[1]!
    const resolvedName = allowedTools
      ? (resolveToolName(name, [...allowedTools]) || name)
      : name
    if (!allowedTools || allowedTools.has(resolvedName)) {
      const args: Record<string, unknown> = {}
      // Match both ||DSML|| and |DSML| variants
      const paramRe = /<\|{1,2}DSML\|{1,2}parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|{1,2}DSML\|{1,2}parameter>/gi
      let m
      while ((m = paramRe.exec(normalized)) !== null) {
        let val = m[2]!
        // Strip CDATA wrapper if present
        if (val.startsWith('<![CDATA[') && val.endsWith(']]>')) {
          val = val.slice(9, -3)
        }
        try { args[m[1]!] = JSON.parse(val) } catch { args[m[1]!] = val }
      }
      results.push({ name: resolvedName, id: `toolu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, arguments: args })
    }
  }

  // ── Native DeepSeek tool_calls markers: <|tool_calls_begin|> ... <|tool_calls_end|>
  const nativeToolCallsRe = /<\|tool[_\s]?calls[_\s]?begin\|>([\s\S]*?)<\|tool[_\s]?calls[_\s]?end\|>/i
  const nativeMatch = normalized.match(nativeToolCallsRe)
  if (nativeMatch && results.length === 0) {
    const inner = nativeMatch[1]!
    // Try to parse as JSON array or object inside the markers
    const jsonContent = extractBalancedJson(inner.trim())
    if (jsonContent) {
      try {
        const parsed = robustParseJSON(jsonContent)
        if (Array.isArray(parsed)) {
          for (const item of parsed) { pushIfValid(item, true) }
        } else {
          pushIfValid(parsed, true)
        }
      } catch { }
    }
  }

  const toolCallTagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = toolCallTagRe.exec(normalized)) !== null) {
    const wrappedJson = extractBalancedJson(tagMatch[1]!.trim())
    if (!wrappedJson) continue
    try { pushIfValid(robustParseJSON(wrappedJson), true) } catch { }
  }

  const MAX_PREFIX_LENGTH = 500
  const toolUseRe = /\{\s*"tool_use"\s*:/g
  let useMatch: RegExpExecArray | null
  while ((useMatch = toolUseRe.exec(normalized)) !== null) {
    // Reject tool calls where the text prefix before the JSON is too long —
    // a long preamble means the model is explaining/showing an example, not calling a tool.
    if (useMatch.index > MAX_PREFIX_LENGTH) continue
    // Reject tool calls that are inside an inline code fence (```...```) embedded in prose.
    const prefix = normalized.slice(0, useMatch.index)
    if (/```/.test(prefix)) continue
    const extracted = extractBalancedJson(normalized.slice(useMatch.index))
    if (!extracted) continue
    try { pushIfValid(robustParseJSON(extracted)) } catch { }
  }

  if (results.length === 0 && source.startsWith('{') && source.endsWith('}')) {
    try {
      pushIfValid(JSON.parse(source))
    } catch {
      for (let i = 1; i <= 2; i++) {
        try {
          pushIfValid(JSON.parse(source + '}'.repeat(i)))
          break
        } catch { }
      }
    }
  }

  return results
}

export function parseToolResponse(
  text: string,
  allowedTools?: ReadonlySet<string>,
): { name: string; id: string; arguments: any } | null {
  return parseToolResponses(text, allowedTools)[0] ?? null
}

function validateToolCall(parsed: any, allowDirectFormat = false): { name: string; arguments: Record<string, unknown> } | null {
  if (!parsed || typeof parsed !== 'object') return null

  // Format 1: {"tool_use": {"name": "...", "arguments": {...}}}
  const toolUse = parsed.tool_use
  if (toolUse && typeof toolUse === 'object' && !Array.isArray(toolUse)) {
    if (typeof toolUse.name !== 'string' || toolUse.name.length === 0) return null
    if (toolUse.arguments !== undefined && (typeof toolUse.arguments !== 'object' || toolUse.arguments === null || Array.isArray(toolUse.arguments))) return null
    return { name: toolUse.name, arguments: toolUse.arguments || {} }
  }

  // Format 2: {"name": "...", "arguments": {...}} — only inside <tool_call> tags
  if (allowDirectFormat && typeof parsed.name === 'string' && parsed.name.length > 0 && parsed.arguments !== undefined) {
    if (typeof parsed.arguments !== 'object' || parsed.arguments === null || Array.isArray(parsed.arguments)) return null
    return { name: parsed.name, arguments: parsed.arguments }
  }

  return null
}

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

  if (depth > 0 && depth <= 2 && !inString) {
    const completed = text.slice(start) + '}'.repeat(depth)
    try {
      JSON.parse(completed)
      return completed
    } catch {
      return null
    }
  }

  return null
}
