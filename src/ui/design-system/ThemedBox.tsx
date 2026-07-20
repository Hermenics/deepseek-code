import Box from '../../ink/components/Box.js'
import type { ThemeColors } from '../theme.js'
import { useThemeColors } from './ThemeProvider.js'

type InkBoxProps = Parameters<typeof Box>[0]

type ColorProp = keyof ThemeColors | (string & {})

export type ThemedBoxProps = Omit<InkBoxProps, 'borderColor' | 'backgroundColor'> & {
  borderColor?: ColorProp
  backgroundColor?: ColorProp
}

function resolveColor(color: ColorProp | undefined, colors: ThemeColors): string | undefined {
  if (!color) return undefined
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi')) return color
  return (colors as unknown as Record<string, string>)[color] ?? color
}

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
