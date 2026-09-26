import Text from '../../ink/components/Text.js'
import { getThemeColors, type ThemeName } from '../theme.js'

/** `Read(src/foo.ts)`: bold tool name in the text color with its argument in parentheses, as Claude Code draws tool calls; no parentheses without an argument. */
export function ToolLabel({ name, arg, theme }: { name: string; arg?: string; theme: ThemeName }) {
  const colors = getThemeColors(theme)
  return (
    <Text wrap="truncate-end">
      <Text bold color={colors.text}>{name}</Text>
      {arg ? <Text color={colors.textDim}>{`(${arg})`}</Text> : null}
    </Text>
  )
}
