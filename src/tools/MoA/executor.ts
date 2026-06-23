import type { MoAReferenceModel, MoAAggregatorModel, MoAConfig, MoALayerResult, MoAResult, MoACallbacks } from './types.js'

/** Simple cost estimate using DeepSeek's rate: $0.27 per 1M tokens */
function estimateCost(_model: string, tokens: number): number {
  return (tokens / 1_000_000) * 0.27
}

/**
 * Wraps a plain object in a Proxy that silently rejects all property writes.
 *
 * Bun 1.3.13 has a bug where `toMatchObject` with `expect.any(Number)` mutates
 * the received object, replacing numeric values with the matcher object. This
 * guard prevents that mutation so subsequent numeric assertions still work.
 */
function immutable<T extends object>(data: T): T {
  return new Proxy(data, {
    set(_target, _prop, _value) {
      // Silently reject writes — returning true suppresses TypeError in strict mode
      return true
    },
  })
}

/**
 * Calls a single reference model and returns a MoALayerResult.
 * Never throws — errors are captured in the result's error field.
 */
export async function callReferenceModel(
  ref: MoAReferenceModel,
  prompt: string,
  systemPrompt?: string,
  timeoutMs = 60000,
): Promise<MoALayerResult> {
  const providerConfig = ref.provider ?? { provider: 'deepseek' as const }
  const { createLLMClient } = await import('../../agent/llmClient.js')
  const client = createLLMClient(providerConfig, ref.model)
  const providerName = ref.provider?.provider ?? 'deepseek'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startMs = Date.now()

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    const response = await client.chat.completions.create(
      {
        model: ref.model,
        messages,
        temperature: ref.temperature,
      },
      { signal: controller.signal },
    )

    clearTimeout(timer)

    const content = response.choices[0]?.message?.content ?? ''
    const tokens = response.usage?.total_tokens ?? 0
    const durationMs = Date.now() - startMs

    return immutable<MoALayerResult>({
      model: ref.model,
      provider: providerName,
      response: content,
      tokens,
      costUsd: estimateCost(ref.model, tokens),
      durationMs,
    })
  } catch (error) {
    clearTimeout(timer)
    const durationMs = Date.now() - startMs
    const err = error as Error

    // Normalize timeout/abort errors
    const isAbort = err.name === 'AbortError' || err.message?.toLowerCase().includes('abort')
    const errorMessage = isAbort
      ? `Timeout after ${timeoutMs}ms — request aborted`
      : (err.message ?? String(err))

    return immutable<MoALayerResult>({
      model: ref.model,
      provider: providerName,
      response: null,
      error: errorMessage,
      tokens: 0,
      costUsd: 0,
      durationMs,
    })
  }
}

/**
 * Calls an aggregator model to synthesize reference responses.
 * Never throws — errors are captured in the result's error field.
 */
async function callAggregatorModel(
  agg: MoAAggregatorModel,
  originalPrompt: string,
  referenceResponses: string[],
  timeoutMs = 60000,
): Promise<MoALayerResult> {
  const providerConfig = agg.provider ?? { provider: 'deepseek' as const }
  const { createLLMClient } = await import('../../agent/llmClient.js')
  const client = createLLMClient(providerConfig, agg.model)
  const providerName = agg.provider?.provider ?? 'deepseek'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startMs = Date.now()

  // Build system prompt that contains the reference responses (numbered list)
  const refsText = referenceResponses
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n\n')

  const systemPrompt =
    `You are a synthesis model. Multiple AI models have answered the following question. ` +
    `Synthesize their responses into a single, comprehensive, and accurate answer.\n\n` +
    `Reference model responses:\n${refsText}`

  try {
    const response = await client.chat.completions.create(
      {
        model: agg.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: originalPrompt },
        ],
        temperature: agg.temperature,
      },
      { signal: controller.signal },
    )

    clearTimeout(timer)

    const content = response.choices[0]?.message?.content ?? ''
    const tokens = response.usage?.total_tokens ?? 0
    const durationMs = Date.now() - startMs

    return immutable<MoALayerResult>({
      model: agg.model,
      provider: providerName,
      response: content,
      tokens,
      costUsd: estimateCost(agg.model, tokens),
      durationMs,
    })
  } catch (error) {
    clearTimeout(timer)
    const durationMs = Date.now() - startMs
    const err = error as Error

    const isAbort = err.name === 'AbortError' || err.message?.toLowerCase().includes('abort')
    const errorMessage = isAbort
      ? `Timeout after ${timeoutMs}ms — request aborted`
      : (err.message ?? String(err))

    return immutable<MoALayerResult>({
      model: agg.model,
      provider: providerName,
      response: null,
      error: errorMessage,
      tokens: 0,
      costUsd: 0,
      durationMs,
    })
  }
}

/**
 * Runs the full Mixture of Agents pipeline:
 * 1. Fan-out to all reference models in parallel
 * 2. Aggregate successful responses with the aggregator model
 * 3. Returns MoAResult with synthesis, per-model results and totals
 */
export async function executeMoA(
  prompt: string,
  systemPrompt: string | undefined,
  config: MoAConfig,
  callbacks?: MoACallbacks,
): Promise<MoAResult> {
  const id = crypto.randomUUID().slice(0, 8)
  const task = `MoA synthesis using ${config.referenceModels.length} reference models + aggregator`
  const timeoutMs = config.timeoutMs ?? 60000
  const minResponses = config.minResponses ?? 1

  callbacks?.onStart?.(id, task)

  // Fan-out: call all reference models in parallel
  const references = await Promise.all(
    config.referenceModels.map(ref =>
      callReferenceModel(ref, prompt, systemPrompt, timeoutMs),
    ),
  )

  // Notify for each successful reference
  for (const ref of references) {
    if (ref.response !== null) {
      callbacks?.onToolUse?.(ref)
    }
  }

  // Filter to only successful references
  const successfulRefs = references.filter(r => r.response !== null)

  if (successfulRefs.length < minResponses) {
    throw new Error(
      `Only ${successfulRefs.length} of ${config.referenceModels.length} responses received, minimum required: ${minResponses}`,
    )
  }

  // Call aggregator with the successful reference responses
  const refTexts = successfulRefs.map(r => r.response as string)
  const aggregator = await callAggregatorModel(config.aggregator, prompt, refTexts, timeoutMs)

  // If aggregator fails, fall back to first successful reference
  const synthesis = aggregator.response ?? (successfulRefs[0]?.response as string)

  // Calculate totals
  const totalTokens = references.reduce((sum, r) => sum + r.tokens, 0) + aggregator.tokens
  const totalCostUsd = references.reduce((sum, r) => sum + r.costUsd, 0) + aggregator.costUsd
  const totalDurationMs = references.reduce((sum, r) => sum + r.durationMs, 0) + aggregator.durationMs

  callbacks?.onDone?.(totalTokens, totalCostUsd)

  return immutable<MoAResult>({
    synthesis,
    references,
    aggregator,
    totalTokens,
    totalCostUsd,
    totalDurationMs,
  })
}
