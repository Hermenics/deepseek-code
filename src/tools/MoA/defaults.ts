import type { MoAConfig } from './types.js'

/** Default panel (two reference models plus a pro aggregator) and limits used when the moa tool gets no overrides. */
export const DEFAULT_MOA_CONFIG: MoAConfig = {
  referenceModels: [
    { model: 'deepseek-flash', weight: 1 },
    { model: 'deepseek-v4-pro', weight: 1 },
  ],
  aggregator: {
    model: 'deepseek-v4-pro',
    temperature: 0.4,
  },
  minResponses: 1,
  timeoutMs: 60000,
  maxRetries: 1,
  maxCandidates: 5,
  concurrency: 5,
}
