/**
 * Verification logic: decides whether to spawn a verifier subagent
 * and provides prompts/parsing for verification results.
 */

import type { SubAgentResult } from './contracts.js'

/**
 * Determine whether a verification subagent should be spawned.
 * Auto-enabled for file changes with low confidence, or when explicitly requested.
 */
export function shouldVerify(_task: string, result: SubAgentResult, explicitVerify?: boolean): boolean {
  // Explicit override takes priority
  if (explicitVerify === true) return true
  if (explicitVerify === false) return false

  // Auto-verify when files were changed and confidence is below threshold
  if (result.filesChanged.length > 0 && result.confidence < 0.7) return true

  // Auto-verify when issues were found (reviewer might have missed something)
  if (result.issuesFound.length > 2 && result.confidence < 0.8) return true

  return false
}

/**
 * Build a prompt for the verification subagent.
 */
export function buildVerifierPrompt(originalTask: string, result: SubAgentResult): string {
  const filesSection = result.filesChanged.length > 0
    ? `\n\nFiles that were modified:\n${result.filesChanged.map(f => `- ${f}`).join('\n')}`
    : ''

  return `You are a verification subagent. Another subagent completed a task and you need to verify the result is correct.

## Original Task
${originalTask}

## Reported Result
Summary: ${result.summary}
Confidence: ${(result.confidence * 100).toFixed(0)}%${filesSection}
${result.issuesFound.length > 0 ? `\nIssues reported: ${result.issuesFound.join('; ')}` : ''}

## Your Job
1. Read the files that were reportedly changed (if any)
2. Verify the changes are correct and complete
3. Check for obvious errors, missing edge cases, or incomplete work

## Output Format
End your response with:
\`\`\`json
{
  "verified": true or false,
  "reason": "brief explanation",
  "issues": ["any new issues found"]
}
\`\`\``
}

export interface VerificationResult {
  verified: boolean
  reason: string
  issues: string[]
}

/**
 * Parse the verification subagent's response.
 */
export function parseVerificationResult(text: string): VerificationResult {
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
  let lastMatch: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    lastMatch = match
  }

  if (!lastMatch) {
    // Fallback: assume verified if no structured output
    return { verified: true, reason: 'No structured verification output', issues: [] }
  }

  try {
    const parsed = JSON.parse(lastMatch[1]!)
    return {
      verified: typeof parsed.verified === 'boolean' ? parsed.verified : true,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    }
  } catch {
    return { verified: true, reason: 'Failed to parse verification output', issues: [] }
  }
}

/**
 * Format verification result for the user/parent.
 */
export function formatVerificationForUser(result: VerificationResult): string {
  const status = result.verified ? '[Verified]' : '[Verification Failed]'
  const parts = [status]
  if (result.reason) parts.push(result.reason)
  if (result.issues.length > 0) parts.push(`Issues: ${result.issues.join('; ')}`)
  return parts.join(' — ')
}
