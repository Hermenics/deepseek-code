// Central application state store
// Extracted from Agent class to enable decoupled state management

export interface AppState {
  // Session
  sessionId: string

  // Provider
  provider: string
  model: string

  // Context tracking
  tokenCount: number
  contextUsage: number
  contextLimit: number

  // Agent
  activeAgent: string | null

  // UI
  isProcessing: boolean
}

type Listener = (state: AppState) => void

const listeners: Set<Listener> = new Set()

let state: AppState = {
  sessionId: '',
  provider: 'deepseek',
  model: 'deepseek-chat',
  tokenCount: 0,
  contextUsage: 0,
  contextLimit: 128_000,
  activeAgent: null,
  isProcessing: false,
}

export function getState(): Readonly<AppState> {
  return state
}

export function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial }
  listeners.forEach(fn => fn(state))
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetState(): void {
  state = {
    sessionId: '',
    provider: 'deepseek',
    model: 'deepseek-chat',
    tokenCount: 0,
    contextUsage: 0,
    contextLimit: 128_000,
    activeAgent: null,
    isProcessing: false,
  }
}
