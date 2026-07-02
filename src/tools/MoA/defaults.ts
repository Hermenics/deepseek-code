import type { MoAConfig } from './types.js'

export const DEFAULT_MOA_CONFIG: MoAConfig = {
  referenceModels: [
    { model: 'deepseek-v4-flash', weight: 1 },
    { model: 'deepseek-v4-pro', weight: 1 },
  ],
  aggregator: {
    model: 'deepseek-v4-pro',
    temperature: 0.4,
  },
  minResponses: 1,
  timeoutMs: 60000,
  maxRetries: 1,
}
