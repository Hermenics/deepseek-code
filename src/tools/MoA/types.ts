import type { ProviderConfig } from '../../types/provider.js'

export interface MoAReferenceModel {
  model: string
  provider?: ProviderConfig
  temperature?: number
  weight?: number
}

export interface MoAAggregatorModel {
  model: string
  provider?: ProviderConfig
  temperature?: number
}

export interface MoAConfig {
  referenceModels: MoAReferenceModel[]
  aggregator: MoAAggregatorModel
  minResponses?: number  // default: 1
  timeoutMs?: number     // default: 60000
  maxRetries?: number    // default: 1
}

export interface MoALayerResult {
  model: string
  provider: string
  response: string | null
  error?: string
  tokens: number
  costUsd: number
  durationMs: number
}

export interface MoAResult {
  synthesis: string
  references: MoALayerResult[]
  aggregator: MoALayerResult
  totalTokens: number
  totalCostUsd: number
  totalDurationMs: number
}

export interface MoACallbacks {
  onStart?: (id: string, task: string) => void
  onToolUse?: (layerResult: MoALayerResult) => void
  onDone?: (totalTokens: number, totalCostUsd: number) => void
}
