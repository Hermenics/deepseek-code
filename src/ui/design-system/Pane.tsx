import type { PropsWithChildren } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { useThemeColors } from './ThemeProvider.js'
import type { ThemeColors } from '../theme.js'

type ColorProp = keyof ThemeColors | (string & {})

export interface PaneProps {
  title?: string
  titleColor?: ColorProp
  dividerColor?: ColorProp
  paddingX?: number
}

function resolveColor(color: ColorProp | undefined, colors: ThemeColors): string | undefined {
  if (!color) return undefined
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi')) return color
  return (colors as unknown as Record<string, string>)[color] ?? color
}

export function Pane({ title, titleColor, dividerColor, paddingX = 1, children }: PropsWithChildren<PaneProps>) {
  const colors = useThemeColors()
  const divColor = resolveColor(dividerColor, colors) ?? colors.primary
  const tColor = resolveColor(titleColor, colors) ?? colors.text

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={divColor}>{'─'.repeat(2)}</Text>
        {title && (
          <>
            <Text color={divColor}> </Text>
            <Text color={tColor} bold>{title}</Text>
            <Text color={divColor}> </Text>
          </>
        )}
        <Text color={divColor}>{'─'.repeat(40)}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={paddingX} paddingRight={paddingX}>
        {children}
      </Box>
    </Box>
  )
}
