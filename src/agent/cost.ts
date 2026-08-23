// DeepSeek pricing (USD per million tokens, July 2026)
// Source: https://api-docs.deepseek.com/quick_start/pricing
const PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  'deepseek-v4-flash': { input: 0.14, cachedInput: 0.0028, output: 0.28 },
  'deepseek-v4-pro':   { input: 0.435, cachedInput: 0.003625, output: 0.87 },
  'deepseek-v4-flash-vision-exp': { input: 0.14, cachedInput: 0.0028, output: 0.28 },
  // Aliases (deprecated 2026/07/24, map to deepseek-v4-flash)
  'deepseek-chat':     { input: 0.14, cachedInput: 0.0028, output: 0.28 },
  'deepseek-reasoner': { input: 0.14, cachedInput: 0.0028, output: 0.28 },
}

// Context window limits per model/provider (1M = 1,000,000 tokens)
// Source: https://api-docs.deepseek.com/quick_start/pricing
const MODEL_CONTEXT: Record<string, number> = {
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro':   1_000_000,
  'deepseek-v4-flash-vision-exp': 1_000_000,
  // Aliases (deprecated 2026/07/24, map to deepseek-v4-flash)
  'deepseek-chat':     1_000_000,
  'deepseek-reasoner': 1_000_000,
}

export function getContextLimit(provider: string, model: string): number {
  if (provider === 'vertex')  return 128_000  // DeepSeek R1 no Vertex (limited by provider)
  if (provider === 'bedrock') return 128_000  // DeepSeek R1 no Bedrock (limited by provider)
  // Conservative fallback for unknown/custom models to avoid delaying compaction
  return MODEL_CONTEXT[model] ?? 128_000
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

export function estimateCost(model: string, usage: TokenUsage): number {
  const p = PRICING[model] ?? PRICING['deepseek-v4-flash']!
  const regularInput = Math.max(0, usage.promptTokens - usage.cachedTokens)
  return (
    (regularInput / 1_000_000) * p.input +
    (usage.cachedTokens / 1_000_000) * p.cachedInput +
    (usage.completionTokens / 1_000_000) * p.output
  )
}

export function formatCost(usd: number): string {
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(4)}`
}
