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
  minResponses?: number
  timeoutMs?: number
  maxRetries?: number
  maxCandidates?: number
  concurrency?: number
}

export type MoALayerStatus = 'done' | 'failed' | 'empty' | 'duplicate'

export interface MoALayerResult {
  candidateId: string
  model: string
  provider: string
  status: MoALayerStatus
  response: string | null
  duplicateOf?: string
  error?: string
  attempts: number
  tokens?: number
  usageAvailable: boolean
  costUsd?: number
  costAvailable: boolean
  durationMs: number
}

export interface MoAResult {
  schemaVersion: 1
  synthesis: string
  references: MoALayerResult[]
  aggregator: MoALayerResult
  totalTokens?: number
  usageAvailable: boolean
  totalCostUsd?: number
  costAvailable: boolean
  totalDurationMs: number
}

export interface MoACallbacks {
  onStart?: (id: string, task: string) => void
  onToolUse?: (layerResult: MoALayerResult) => void
  onDone?: (totalTokens?: number, totalCostUsd?: number) => void
  onError?: (error: MoAExecutionError) => void
}

export class MoAExecutionError extends Error {
  constructor(
    readonly code: 'INVALID_CONFIG' | 'INSUFFICIENT_CANDIDATES' | 'AGGREGATOR_FAILED' | 'BUDGET_EXCEEDED' | 'CANCELLED',
    message: string,
    readonly partial: { references: MoALayerResult[]; aggregator?: MoALayerResult },
  ) {
    super(message)
    this.name = 'MoAExecutionError'
  }
}
