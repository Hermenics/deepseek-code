import type { Tool } from '../types.js'
import { executeMoA } from './executor.js'
import { DEFAULT_MOA_CONFIG } from './defaults.js'
import type { MoAConfig, MoAReferenceModel } from './types.js'

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
  async execute(args, context) {
    const prompt = args.prompt as string
    const systemPrompt = args.systemPrompt as string | undefined
    const refModelsOverride = args.referenceModels as MoAReferenceModel[] | undefined
    const aggModelOverride = args.aggregatorModel as string | undefined

    const config: MoAConfig = {
      ...DEFAULT_MOA_CONFIG,
      ...(refModelsOverride ? { referenceModels: refModelsOverride } : {}),
      aggregator: aggModelOverride
        ? { ...DEFAULT_MOA_CONFIG.aggregator, model: aggModelOverride }
        : DEFAULT_MOA_CONFIG.aggregator,
    }

    const result = await executeMoA(prompt, systemPrompt, config, undefined, context)
    return result.synthesis
  },
}
