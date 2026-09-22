import { createContext, useContext, type PropsWithChildren } from 'react'
import type { ThemeName } from '../../types/provider.js'
import { getThemeColors, type ThemeColors } from '../theme.js'

const ThemeContext = createContext<ThemeName>('dark')

/** Makes the active theme name available to design-system components below it (defaults to dark without a provider). */
export function ThemeProvider({ value, children }: PropsWithChildren<{ value: ThemeName }>) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeName {
  return useContext(ThemeContext)
}

/** Resolves the palette of the theme from the nearest ThemeProvider. */
export function useThemeColors(): ThemeColors {
  return getThemeColors(useContext(ThemeContext))
}
