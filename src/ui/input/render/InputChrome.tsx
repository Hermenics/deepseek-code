import { getThemeColors, STATUS_ICONS } from '../../theme.js'
import type { ThemeName } from '../../theme.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'
import { applyColor } from '../../../ink/colorize.js'
import type { Color } from '../../../ink/styles.js'

interface InputChromeProps {
  columns: number
  agentLabel?: string
  agentColor?: string
  contextPct?: number
  hasExclamation?: boolean
  theme?: ThemeName
  children: React.ReactNode
}

/** Frames the prompt input in a rounded box with the agent label inset in the top border, then a row with the prompt icon (bash icon when `hasExclamation`), the context-usage percentage coloured by threshold (hidden at 0) and the input itself. */
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
  const resolvedAgentColor = agentColor || colors.h2

  // Prompt indicator
  const promptIcon = hasExclamation ? STATUS_ICONS.bash : STATUS_ICONS.prompt
  const promptColor = hasExclamation ? colors.bashBorder : colors.promptBorder

  return (
    <Box
      borderStyle="round"
      borderColor={colors.promptBorder}
      borderText={{ content: applyColor(` ${agentLabel} `, resolvedAgentColor as Color), position: 'top', align: 'end', offset: 1 }}
      paddingX={1}
      flexDirection="row"
      gap={1}
    >
      <Text color={promptColor}>{promptIcon}</Text>
      {contextPct > 0 && (
        <Text color={contextPct >= 90 ? colors.error : contextPct >= 70 ? colors.warning : colors.primary}>
          {contextPct + '%'}
        </Text>
      )}
      <Box flexGrow={1}>{children}</Box>
    </Box>
  )
}
