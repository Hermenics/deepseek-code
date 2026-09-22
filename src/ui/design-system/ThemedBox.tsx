import Box from '../../ink/components/Box.js'
import type { ThemeColors } from '../theme.js'
import { useThemeColors } from './ThemeProvider.js'

type InkBoxProps = Parameters<typeof Box>[0]

type ColorProp = keyof ThemeColors | (string & {})

export type ThemedBoxProps = Omit<InkBoxProps, 'borderColor' | 'backgroundColor'> & {
  borderColor?: ColorProp
  backgroundColor?: ColorProp
}

/** Maps a theme color key (e.g. `primary`) to its value from the active palette; rgb(), hex and ansi literals and unknown names pass through unchanged. */
function resolveColor(color: ColorProp | undefined, colors: ThemeColors): string | undefined {
  if (!color) return undefined
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi')) return color
  return (colors as unknown as Record<string, string>)[color] ?? color
}

/** Ink Box whose border and background colors accept theme color keys as well as literal colors. */
export function ThemedBox({ borderColor, backgroundColor, children, ...rest }: ThemedBoxProps) {
  const colors = useThemeColors()
  return (
    <Box
      borderColor={resolveColor(borderColor, colors)}
      backgroundColor={resolveColor(backgroundColor, colors)}
      {...rest}
    >
      {children}
    </Box>
  )
}
