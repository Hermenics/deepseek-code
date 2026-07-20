import { createContext, useContext, type PropsWithChildren } from 'react'
import type { ThemeName } from '../../types/provider.js'
import { getThemeColors, type ThemeColors } from '../theme.js'

const ThemeContext = createContext<ThemeName>('dark')

export function ThemeProvider({ value, children }: PropsWithChildren<{ value: ThemeName }>) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeName {
  return useContext(ThemeContext)
}

export function useThemeColors(): ThemeColors {
  return getThemeColors(useContext(ThemeContext))
}
