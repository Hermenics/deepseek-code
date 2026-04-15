// DeepSeek pricing (USD per million tokens, April 2026)
const PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  'deepseek-chat':     { input: 0.27, cachedInput: 0.07, output: 1.10 },
  'deepseek-reasoner': { input: 0.55, cachedInput: 0.14, output: 2.19 },
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

export function estimateCost(model: string, usage: TokenUsage): number {
  const p = PRICING[model] ?? PRICING['deepseek-chat']!
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
