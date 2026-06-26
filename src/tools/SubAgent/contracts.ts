/**
 * Structured result contract for subagent outputs.
 */

export interface SubAgentResult {
  summary: string
  confidence: number
  filesRead: string[]
  filesChanged: string[]
  issuesFound: string[]
  suggestions: string[]
  metadata: Record<string, unknown>
}

const DEFAULT_RESULT: SubAgentResult = {
  summary: '',
  confidence: 0.5,
  filesRead: [],
  filesChanged: [],
  issuesFound: [],
  suggestions: [],
  metadata: {},
}

/**
 * Parse structured JSON from the end of a subagent's free-text response.
 * Falls back gracefully if no JSON block is found.
 */
export function parseSubAgentResult(text: string): SubAgentResult {
  // Look for the last ```json ... ``` block
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
  let lastMatch: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    lastMatch = match
  }

  if (!lastMatch) {
    return { ...DEFAULT_RESULT, summary: text.slice(0, 200) }
  }

  try {
    const parsed = JSON.parse(lastMatch[1]!)
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : text.slice(0, 200),
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      filesRead: Array.isArray(parsed.filesRead) ? parsed.filesRead : [],
      filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
      issuesFound: Array.isArray(parsed.issuesFound) ? parsed.issuesFound : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      metadata: typeof parsed.metadata === 'object' && parsed.metadata !== null ? parsed.metadata : {},
    }
  } catch {
    return { ...DEFAULT_RESULT, summary: text.slice(0, 200) }
  }
}

/**
 * Format structured result for the parent agent's consumption.
 */
export function formatResultForParent(result: SubAgentResult): string {
  const parts: string[] = [result.summary]

  if (result.filesChanged.length > 0) {
    parts.push(`Files changed: ${result.filesChanged.join(', ')}`)
  }
  if (result.issuesFound.length > 0) {
    parts.push(`Issues: ${result.issuesFound.join('; ')}`)
  }
  if (result.suggestions.length > 0) {
    parts.push(`Suggestions: ${result.suggestions.join('; ')}`)
  }
  parts.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`)

  return parts.join('\n')
}
