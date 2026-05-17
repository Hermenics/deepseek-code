import type { ChatMessage } from '../types/index.js'

export interface ToolDef {
  name: string
  description?: string
  input_schema?: any
}

const TOOL_PROMPT = `You have access to tools. When you need to use a tool, respond ONLY with a JSON block in this exact format (no other text before or after):

\`\`\`json
{"tool_use": {"name": "tool_name", "arguments": {"param": "value"}}}
\`\`\`

If you don't need a tool, respond normally with text.
Available tools:
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

export function parseToolResponse(text: string): { name: string; id: string; arguments: any } | null {
  const dsmlInvoke = text.match(/<\|{2}DSML\|{2}invoke\s+name="([^"]+)">/)
  if (dsmlInvoke) {
    const name = dsmlInvoke[1]!
    const args: Record<string, any> = {}
    const paramRe = /<\|{2}DSML\|{2}parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|{2}DSML\|{2}parameter>/g
    let m
    while ((m = paramRe.exec(text)) !== null) {
      try { args[m[1]!] = JSON.parse(m[2]!) } catch { args[m[1]!] = m[2]! }
    }
    return { name, id: `toolu_${Date.now().toString(36)}`, arguments: args }
  }

  const toolCallTag = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/)
  const jsonSource = toolCallTag ? toolCallTag[1]! : text

  const patterns = [
    /```json\s*\n?\s*(\{[\s\S]*?"tool_use"[\s\S]*?\})\s*\n?\s*```/,
    /(\{"tool_use"\s*:\s*\{[\s\S]*?\}\s*\})/,
  ]
  for (const pattern of patterns) {
    const match = jsonSource.match(pattern)
    if (match) {
      try {
        const parsed = JSON.parse(match[1]!)
        if (parsed.tool_use?.name) {
          return {
            name: parsed.tool_use.name,
            id: `toolu_${Date.now().toString(36)}`,
            arguments: parsed.tool_use.arguments || {},
          }
        }
      } catch {}
    }
  }

  if (toolCallTag) {
    try {
      const parsed = JSON.parse(jsonSource)
      if (parsed.tool_use?.name) {
        return { name: parsed.tool_use.name, id: `toolu_${Date.now().toString(36)}`, arguments: parsed.tool_use.arguments || {} }
      }
    } catch {}
  }

  return null
}
