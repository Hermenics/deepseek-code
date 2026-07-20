import Text from '../../ink/components/Text.js'
import { useThemeColors } from './ThemeProvider.js'
import type { ThemeColors } from '../theme.js'

type ColorProp = keyof ThemeColors | (string & {})

export interface ProgressBarProps {
  ratio: number
  width?: number
  fillColor?: ColorProp
  emptyColor?: ColorProp
}

const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█']

function resolveColor(color: ColorProp | undefined, colors: ThemeColors): string | undefined {
  if (!color) return undefined
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi')) return color
  return (colors as unknown as Record<string, string>)[color] ?? color
}

export function ProgressBar({ ratio, width = 20, fillColor, emptyColor }: ProgressBarProps) {
  const colors = useThemeColors()
  const fill = resolveColor(fillColor, colors) ?? colors.primary
  const empty = resolveColor(emptyColor, colors) ?? colors.textInactive

  const safeWidth = Math.max(1, Math.floor(Number.isFinite(width) ? width : 20))
  const clamped = Math.max(0, Math.min(1, ratio))
  const totalSubChars = safeWidth * 8
  const filledSubChars = Math.round(clamped * totalSubChars)
  const fullBlocks = Math.floor(filledSubChars / 8)
  const partialIndex = filledSubChars % 8
  const emptyBlocks = safeWidth - fullBlocks - (partialIndex > 0 ? 1 : 0)

  const filled = BLOCKS[8]!.repeat(fullBlocks)
  const partial = partialIndex > 0 ? BLOCKS[partialIndex]! : ''
  const emptyStr = ' '.repeat(Math.max(0, emptyBlocks))

  return (
    <Text>
      <Text color={fill}>{filled}{partial}</Text>
      <Text color={empty}>{emptyStr}</Text>
    </Text>
  )
}
