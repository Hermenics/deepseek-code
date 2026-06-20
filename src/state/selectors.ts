import { getState, type AppState } from './store.js'

export function getContextPercentage(): number {
  const { contextUsage, contextLimit } = getState()
  return contextLimit > 0 ? contextUsage / contextLimit : 0
}

export function isNearContextLimit(): boolean {
  return getContextPercentage() > 0.8
}

export function getProviderDisplay(): string {
  const { provider, model } = getState()
  return `${provider}/${model}`
}
