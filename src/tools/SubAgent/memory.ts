/**
 * Ephemeral task memory for subagent coordination within a single user turn.
 */

export interface PreviousResult {
  task: string
  summary: string
  confidence: number
}

export interface TaskMemory {
  previousResults: PreviousResult[]
}

let currentMemory: TaskMemory = { previousResults: [] }

export function getCurrentMemory(): TaskMemory {
  return currentMemory
}

export function resetMemory(): void {
  currentMemory = { previousResults: [] }
}

export function addPreviousResult(memory: TaskMemory, task: string, summary: string, confidence: number): void {
  memory.previousResults.push({ task: task.slice(0, 200), summary: summary.slice(0, 300), confidence })
}

/**
 * Format memory context for injection into the subagent prompt.
 * Returns empty string if no previous results exist.
 */
export function formatMemoryForPrompt(memory: TaskMemory): string {
  if (memory.previousResults.length === 0) return ''

  const entries = memory.previousResults.map((r, i) =>
    `${i + 1}. [confidence: ${(r.confidence * 100).toFixed(0)}%] ${r.task}\n   Result: ${r.summary}`
  ).join('\n')

  return `## Previous Subagent Results (this turn)\n${entries}`
}
