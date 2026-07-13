export interface ContextCategory {
  name: string
  tokens: number      // estimated
  percent: number     // of contextUsage
  color: string       // for display
}

export interface ContextBreakdown {
  categories: ContextCategory[]
  total: number        // contextUsage from API (exact)
  limit: number        // contextLimit
  usagePercent: number // total/limit * 100
  suggestions: string[]
  stale: boolean       // true if post-compact, no new API response yet
}

export interface ContextSnapshotInput {
  systemPrompt: string
  toolsPayload: string            // the actual string sent to provider
  messages: Array<{ role: string; content?: string | null; tool_calls?: unknown[]; reasoning_content?: string | null }>
  contextUsage: number
  contextLimit: number
}

const MEMORY_START = '--- MEMORY ---'
const MEMORY_END = '--- END MEMORY ---'

function extractMemoryFromPrompt(prompt: string): { memory: string; promptWithoutMemory: string } {
  const startIdx = prompt.indexOf(MEMORY_START)
  if (startIdx === -1) return { memory: '', promptWithoutMemory: prompt }
  const endIdx = prompt.indexOf(MEMORY_END, startIdx)
  const end = endIdx === -1 ? prompt.length : endIdx + MEMORY_END.length
  const memory = prompt.slice(startIdx, end)
  const promptWithoutMemory = prompt.slice(0, startIdx) + prompt.slice(end)
  return { memory, promptWithoutMemory }
}

export function estimateContextBreakdown(input: ContextSnapshotInput): ContextBreakdown {
  const { systemPrompt, toolsPayload, messages, contextUsage, contextLimit } = input

  // If no API response yet, return stale
  if (contextUsage === 0) {
    return {
      categories: [],
      total: 0,
      limit: contextLimit,
      usagePercent: 0,
      suggestions: [],
      stale: true,
    }
  }

  // Extract memory section from system prompt
  const { memory, promptWithoutMemory } = extractMemoryFromPrompt(systemPrompt)

  // Measure character lengths for each category
  const systemPromptChars = promptWithoutMemory.length
  const memoryChars = memory.length
  const toolsChars = toolsPayload.length

  let userAssistantChars = 0
  let toolResultChars = 0

  for (const msg of messages) {
    const contentLen = typeof msg.content === 'string' ? msg.content.length : 0
    const toolCallsLen = msg.tool_calls ? JSON.stringify(msg.tool_calls).length : 0
    const reasoningLen = typeof msg.reasoning_content === 'string' ? msg.reasoning_content.length : 0
    const totalMsgLen = contentLen + toolCallsLen + reasoningLen

    if (msg.role === 'tool') {
      toolResultChars += totalMsgLen
    } else if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('<tool_result>')) {
      // Bedrock-style tool results embedded in user messages
      toolResultChars += totalMsgLen
    } else {
      userAssistantChars += totalMsgLen
    }
  }

  // Distribute contextUsage proportionally
  const totalChars = systemPromptChars + memoryChars + toolsChars + userAssistantChars + toolResultChars
  if (totalChars === 0) {
    return {
      categories: [{ name: 'Free', tokens: Math.max(0, contextLimit - contextUsage), percent: 0, color: 'dim' }],
      total: contextUsage,
      limit: contextLimit,
      usagePercent: (contextUsage / contextLimit) * 100,
      suggestions: [],
      stale: false,
    }
  }

  const distribute = (chars: number): number => Math.round((chars / totalChars) * contextUsage)

  const systemTokens = distribute(systemPromptChars)
  const memoryTokens = distribute(memoryChars)
  const toolsTokens = distribute(toolsChars)
  const toolResultTokens = distribute(toolResultChars)
  // Messages gets the remainder to ensure exact sum
  const messagesTokens = contextUsage - systemTokens - memoryTokens - toolsTokens - toolResultTokens

  const categories: ContextCategory[] = []

  if (systemTokens > 0) categories.push({ name: 'System Prompt', tokens: systemTokens, percent: (systemTokens / contextUsage) * 100, color: 'cyan' })
  if (memoryTokens > 0) categories.push({ name: 'Memory', tokens: memoryTokens, percent: (memoryTokens / contextUsage) * 100, color: 'green' })
  if (toolsTokens > 0) categories.push({ name: 'Tools', tokens: toolsTokens, percent: (toolsTokens / contextUsage) * 100, color: 'blue' })
  if (messagesTokens > 0) categories.push({ name: 'Messages', tokens: messagesTokens, percent: (messagesTokens / contextUsage) * 100, color: 'yellow' })
  if (toolResultTokens > 0) categories.push({ name: 'Tool Results', tokens: toolResultTokens, percent: (toolResultTokens / contextUsage) * 100, color: 'magenta' })

  const freeTokens = Math.max(0, contextLimit - contextUsage)
  categories.push({ name: 'Free', tokens: freeTokens, percent: (freeTokens / contextLimit) * 100, color: 'dim' })

  // Suggestions based on proportion of USED context
  const suggestions: string[] = []
  const usageRatio = contextUsage / contextLimit

  if (usageRatio >= 0.85) {
    suggestions.push('⚠️  Context nearly full. Run /compact to free up space.')
  }
  if (toolResultTokens / contextUsage > 0.4) {
    suggestions.push('💡 Tool results consuming >40% of used context. Consider /compact.')
  }
  if (messagesTokens / contextUsage > 0.6) {
    suggestions.push('💡 Message history consuming >60%. Use /compact or /clear.')
  }

  return {
    categories,
    total: contextUsage,
    limit: contextLimit,
    usagePercent: usageRatio * 100,
    suggestions,
    stale: false,
  }
}

export function formatContextBreakdown(breakdown: ContextBreakdown): string {
  if (breakdown.stale) {
    return '⏳ Waiting for first API response; breakdown unavailable.'
  }

  const BAR_WIDTH = 20
  const lines: string[] = []

  const usedStr = breakdown.total.toLocaleString()
  const limitStr = breakdown.limit.toLocaleString()
  lines.push(`Context: ${breakdown.usagePercent.toFixed(1)}% (${usedStr} / ${limitStr} tokens)`)
  lines.push('')
  lines.push('  (proportional estimates — total is exact from provider)')
  lines.push('')

  for (const cat of breakdown.categories) {
    const barFilled = cat.name === 'Free'
      ? Math.round((cat.tokens / breakdown.limit) * BAR_WIDTH)
      : Math.round((cat.tokens / breakdown.limit) * BAR_WIDTH)
    const filled = Math.min(barFilled, BAR_WIDTH)
    const empty = BAR_WIDTH - filled
    const bar = '█'.repeat(filled) + '░'.repeat(empty)
    const pct = cat.name === 'Free'
      ? `${((cat.tokens / breakdown.limit) * 100).toFixed(0)}%`
      : `${cat.percent.toFixed(0)}%`
    const tokStr = cat.tokens.toLocaleString().padStart(10)
    const name = cat.name.padEnd(14)
    lines.push(`  ${name} ${bar}  ${pct.padStart(4)}  ${tokStr}`)
  }

  if (breakdown.suggestions.length > 0) {
    lines.push('')
    for (const s of breakdown.suggestions) {
      lines.push(`  ${s}`)
    }
  }

  return lines.join('\n')
}
