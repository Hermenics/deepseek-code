import Text from '../../ink/components/Text.js'
import type { ThemeColors } from '../theme.js'
import { useThemeColors } from './ThemeProvider.js'

type InkTextProps = Parameters<typeof Text>[0]

type ColorProp = keyof ThemeColors | (string & {})

export type ThemedTextProps = Omit<InkTextProps, 'color' | 'backgroundColor'> & {
  color?: ColorProp
  backgroundColor?: ColorProp
  dimColor?: boolean
}

/** Maps a theme color key (e.g. `primary`) to its value from the active palette; rgb(), hex and ansi literals and unknown names pass through unchanged. */
function resolveColor(color: ColorProp | undefined, colors: ThemeColors): string | undefined {
  if (!color) return undefined
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi')) return color
  return (colors as unknown as Record<string, string>)[color] ?? color
}

/** Ink Text whose colors accept theme color keys; `dimColor` swaps in the theme's dim text color instead of the terminal dim attribute. */
export function ThemedText({ color, backgroundColor, dimColor, children, ...rest }: ThemedTextProps) {
  const colors = useThemeColors()
  const resolved = dimColor ? colors.textDim : resolveColor(color, colors)
  const resolvedBg = resolveColor(backgroundColor, colors)
  return (
    <Text color={resolved} backgroundColor={resolvedBg} {...rest}>
      {children}
    </Text>
  )
}
