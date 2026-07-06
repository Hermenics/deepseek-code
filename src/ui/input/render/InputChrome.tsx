import { getThemeColors, DIVIDER_CHAR, STATUS_ICONS } from '../../theme.js'
import type { ThemeName } from '../../theme.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'

interface InputChromeProps {
  columns: number
  agentLabel?: string
  agentColor?: string
  contextPct?: number
  hasExclamation?: boolean
  theme?: ThemeName
  children: React.ReactNode
}

export function InputChrome({
  columns,
  agentLabel = 'deepseek',
  agentColor,
  contextPct = 0,
  hasExclamation = false,
  theme = 'dark',
  children,
}: InputChromeProps) {
  const colors = getThemeColors(theme)
  const resolvedAgentColor = agentColor || '#87ceeb' // light blue default

  // Top border with agent label
  const agentTag = ` ${agentLabel} `
  const topLineWidth = Math.max(0, columns - 4 - agentTag.length)

  // Prompt indicator
  const promptIcon = hasExclamation ? STATUS_ICONS.bash : STATUS_ICONS.user
  const promptColor = hasExclamation ? colors.bashBorder : colors.promptBorder

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Box flexDirection="row">
        <Text color={colors.promptBorder}>{DIVIDER_CHAR.repeat(topLineWidth)}</Text>
        <Text color={resolvedAgentColor}>{agentTag}</Text>
      </Box>

      {/* Input area with prompt indicator */}
      <Box flexDirection="row" gap={1}>
        <Text color={promptColor}>{promptIcon}</Text>
        {contextPct > 0 && (
          <Text color={contextPct >= 90 ? colors.error : contextPct >= 70 ? colors.warning : colors.primary}>
            {contextPct + '%'}
          </Text>
        )}
        <Box flexGrow={1}>{children}</Box>
      </Box>

    </Box>
  )
}
