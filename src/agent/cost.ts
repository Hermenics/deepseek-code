import DEEPSEEK from './deepseekModels.json'

// DeepSeek models, limits and pricing (USD per 1M tokens) come from deepseekModels.json, synced from
// https://api-docs.deepseek.com/quick_start/pricing by scripts/update-deepseek-models.ts.
const DEEPSEEK_MODELS = new Map(DEEPSEEK.models.map((model) => [model.id, model]))
const DEFAULT_PRICED_MODEL = DEEPSEEK_MODELS.get('deepseek-flash') ?? DEEPSEEK.models[0]!

/** Looks up a DeepSeek model entry by id, resolving legacy aliases. */
function deepseekModel(id: string) {
  return DEEPSEEK_MODELS.get(id) ?? DEEPSEEK_MODELS.get((DEEPSEEK.legacyAliases as Record<string, string>)[id] ?? '')
}

// Context windows for non-DeepSeek models reachable through OpenAI-compatible endpoints.
const OTHER_MODEL_CONTEXT: Record<string, number> = {
  'gpt-6-astra': 1_050_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'gpt-daybreak-blue-latest': 1_050_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.4-mini': 400_000,
}

/** Returns the model's context window, defaulting to 128k tokens when unknown. */
export function getContextLimit(provider: string, model: string): number {
  return getKnownContextLimit(provider, model) ?? 128_000
}

/** Returns the known context window for a provider/model (provider prefix stripped), or undefined when unknown. Vertex and Bedrock are capped at 128k. */
export function getKnownContextLimit(provider: string, model: string): number | undefined {
  if (provider === 'vertex')  return 128_000  // DeepSeek R1 no Vertex (limited by provider)
  if (provider === 'bedrock') return 128_000  // DeepSeek R1 no Bedrock (limited by provider)
  const id = model.split('/').pop() ?? model
  return deepseekModel(id)?.contextTokens ?? OTHER_MODEL_CONTEXT[id]
}

/** Formats a token count as a short label such as `1M context`, `1.05M context` or `128k context`. */
export function formatContextLimit(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(2).replace(/0+$/, '')}M context`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k context`
  return `${tokens} context`
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** True when DeepSeek bills peak rates at `at` (UTC weekday hour ranges, end exclusive). */
export function isPeakTime(at: Date): boolean {
  if (!DEEPSEEK.peakHoursUtc.weekdays.includes(at.getUTCDay())) return false
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes()
  return DEEPSEEK.peakHoursUtc.ranges.some(([start, end]) => minute >= toMinutes(start!) && minute < toMinutes(end!))
}

/** Prices usage at the peak or off-peak rate in effect at `at`; unknown models use Flash rates. */
export function estimateCost(model: string, usage: TokenUsage, at: Date = new Date()): number {
  const { pricing } = deepseekModel(model) ?? DEFAULT_PRICED_MODEL
  const rates = isPeakTime(at) ? pricing.peak : pricing.offPeak
  // An inconsistent report can claim more cache hits than prompt tokens; never bill more input than was sent.
  const cachedInput = Math.min(Math.max(0, usage.cachedTokens), usage.promptTokens)
  const regularInput = Math.max(0, usage.promptTokens - cachedInput)
  return (
    (regularInput / 1_000_000) * rates.cacheMiss +
    (cachedInput / 1_000_000) * rates.cacheHit +
    (usage.completionTokens / 1_000_000) * rates.output
  )
}

/** Formats a USD amount with four decimals; anything below $0.0001 (including zero) shows as `<$0.0001`. */
export function formatCost(usd: number): string {
  if (usd < 0.0001) return '<$0.0001'
  return `$${usd.toFixed(4)}`
}
