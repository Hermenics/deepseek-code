import { createContext, useContext } from 'react'
import type { AppState } from '../state/store.js'

export interface AppContextValue {
  state: AppState
  dispatch: (partial: Partial<AppState>) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppContext.Provider')
  return ctx
}
