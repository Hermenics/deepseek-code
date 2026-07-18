import { SUBAGENT_RESULT_SCHEMA, validateSchema } from '../../orchestration/schema.js'

export interface SubAgentResult {
  summary: string
  confidence: number
  filesRead: string[]
  filesChanged: string[]
  issuesFound: string[]
  suggestions: string[]
  metadata: Record<string, unknown>
}

export class StructuredOutputError extends Error {
  constructor(readonly code: 'INVALID_RESULT' | 'MAX_ITERATIONS', message: string, readonly rawOutput: string) {
    super(message)
    this.name = 'StructuredOutputError'
  }
}

export function validateSubAgentResult(value: unknown): SubAgentResult {
  const validation = validateSchema<SubAgentResult>(SUBAGENT_RESULT_SCHEMA, value)
  if (!validation.valid) throw new StructuredOutputError('INVALID_RESULT', `Invalid subagent result: ${validation.errors.join('; ')}`, JSON.stringify(value))
  return validation.value!
}

/** Compatibility parser. Accepts one complete JSON value; Markdown extraction is intentionally unsupported. */
export function parseSubAgentResult(text: string): SubAgentResult {
  let value: unknown
  try { value = JSON.parse(text) } catch (error) {
    throw new StructuredOutputError('INVALID_RESULT', `Subagent output is not valid JSON: ${(error as Error).message}`, text)
  }
  return validateSubAgentResult(value)
}

export function formatResultForParent(result: SubAgentResult): string {
  const parts: string[] = [result.summary]
  if (result.filesChanged.length > 0) parts.push(`Files changed: ${result.filesChanged.join(', ')}`)
  if (result.issuesFound.length > 0) parts.push(`Issues: ${result.issuesFound.join('; ')}`)
  if (result.suggestions.length > 0) parts.push(`Suggestions: ${result.suggestions.join('; ')}`)
  parts.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`)
  return parts.join('\n')
}
