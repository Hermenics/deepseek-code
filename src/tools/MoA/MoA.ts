import type { Tool, ToolCallbacks } from '../types.js'
import { executeMoA } from './executor.js'
import { DEFAULT_MOA_CONFIG } from './defaults.js'
import { budgetProfile, moaPanelSize } from '../../settings/budget.js'
import type { MoAConfig, MoAExecutionError, MoACallbacks, MoALayerResult, MoAReferenceModel } from './types.js'

function progressArgs(stage: string, values: Record<string, unknown> = {}): Record<string, unknown> {
  return { stage, ...values }
}

function progressCallbacks(callbacks?: ToolCallbacks): MoACallbacks | undefined {
  if (!callbacks?.onToolCall) return undefined
  const report = (stage: string, values?: Record<string, unknown>) => callbacks.onToolCall?.('moa', progressArgs(stage, values))
  return {
    onStart: (id, task) => report('start', { id, task }),
    onToolUse: (layer: MoALayerResult) => report(layer.candidateId === 'aggregator' ? 'aggregator' : 'layer', {
      state: layer.status, candidateId: layer.candidateId, model: layer.model, attempts: layer.attempts,
    }),
    onDone: (totalTokens, totalCostUsd) => report('done', { totalTokens, totalCostUsd }),
    onError: (error: MoAExecutionError) => report('error', { code: error.code, message: error.message }),
  }
}

export const MoATool: Tool = {
  name: 'moa',
  description:
    'Mixture of Agents: sends the same prompt to multiple models in parallel, then synthesizes their responses with an aggregator model. Use it for critical decisions that benefit from diverse perspectives.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      prompt: {
        type: 'string',
        description: 'The prompt to send to every model.',
      },
      systemPrompt: {
        type: 'string',
        description: 'Shared system prompt (optional).',
      },
      referenceModels: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        description: 'Override the reference models.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            model: { type: 'string' },
            temperature: { type: 'number' },
          },
          required: ['model'],
        },
      },
      aggregatorModel: {
        type: 'string',
        description: 'Override the aggregator model.',
      },
    },
    required: ['prompt'],
  },
  async execute(args, context, callbacks) {
    const prompt = args.prompt as string
    const systemPrompt = args.systemPrompt as string | undefined
    const refModelsOverride = args.referenceModels as MoAReferenceModel[] | undefined
    const aggModelOverride = args.aggregatorModel as string | undefined

    // One query here is one call per reference model plus the aggregator,
    // which makes it the most expensive thing a single turn can do. The
    // budget level decides how wide the panel gets, and at the cheapest
    // level the tool says no out loud rather than quietly answering with
    // one model under a name that promises several.
    const budget = context?.session?.runtimeSnapshot().settings.budget
    const requested = refModelsOverride ?? DEFAULT_MOA_CONFIG.referenceModels
    const panel = moaPanelSize(budget, requested.length)
    if (panel === 0) {
      throw new Error(
        `Mixture-of-agents is off at the "${budgetProfile(budget).label}" budget level, because it costs one model call per reference plus the aggregator. Raise the level in /config, or ask a single model directly.`,
      )
    }

    const config: MoAConfig = {
      ...DEFAULT_MOA_CONFIG,
      referenceModels: requested.slice(0, panel),
      aggregator: aggModelOverride
        ? { ...DEFAULT_MOA_CONFIG.aggregator, model: aggModelOverride }
        : DEFAULT_MOA_CONFIG.aggregator,
    }

    const result = await executeMoA(prompt, systemPrompt, config, progressCallbacks(callbacks), context)
    return result.synthesis
  },
}
