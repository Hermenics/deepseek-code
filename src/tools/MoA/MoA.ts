import type { Tool } from '../types.js'
import { executeMoA } from './executor.js'
import { DEFAULT_MOA_CONFIG } from './defaults.js'
import type { MoAConfig, MoAReferenceModel } from './types.js'

export const MoATool: Tool = {
  name: 'moa',
  description:
    'Mixture of Agents: envia o mesmo prompt para múltiplos modelos em paralelo, depois sintetiza as respostas com um modelo agregador. Use para decisões críticas que se beneficiam de perspectivas diversas.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'O prompt a ser enviado para todos os modelos.',
      },
      systemPrompt: {
        type: 'string',
        description: 'System prompt compartilhado (opcional).',
      },
      referenceModels: {
        type: 'array',
        description: 'Override dos modelos de referência.',
        items: {
          type: 'object',
          properties: {
            model: { type: 'string' },
            temperature: { type: 'number' },
          },
          required: ['model'],
        },
      },
      aggregatorModel: {
        type: 'string',
        description: 'Override do modelo agregador.',
      },
    },
    required: ['prompt'],
  },
  async execute(args) {
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

    const result = await executeMoA(prompt, systemPrompt, config)
    return result.synthesis
  },
}
