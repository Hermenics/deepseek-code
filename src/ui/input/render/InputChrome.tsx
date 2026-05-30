import { getThemeColors, DIVIDER_CHAR, STATUS_ICONS } from '../../theme.js'
import type { ThemeName } from '../../theme.js'
import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../../interactionMode.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'

interface InputChromeProps {
  columns: number
  agentLabel?: string
  interactionMode: string
  modeLabel: string
  modeColor: string
  vimEnabled?: boolean
  vimMode?: 'insert' | 'normal'
  contextPct?: number
  hasExclamation?: boolean
  theme?: ThemeName
  children: React.ReactNode
}

export function InputChrome({
  columns,
  agentLabel = 'deepseek',
  interactionMode,
  modeLabel,
  modeColor,
  vimEnabled = false,
  vimMode = 'insert',
  contextPct = 0,
  hasExclamation = false,
  theme = 'dark',
  children,
}: InputChromeProps) {
  const colors = getThemeColors(theme)
  const resolvedModeLabel = modeLabel || MODE_LABELS[interactionMode as InteractionMode]
  const resolvedModeColor = modeColor || MODE_COLORS[interactionMode as InteractionMode]
  const vimLabel = vimEnabled ? (vimMode === 'normal' ? ' [N]' : ' [I]') : ''

  // Top border with mode indicator (Claude Code style)
  const modeTag = ` ${resolvedModeLabel} `
  const agentTag = ` ${agentLabel} `
  const rightSection = modeTag + agentTag
  const topLineWidth = Math.max(0, columns - 4 - rightSection.length)
  const topDashes = DIVIDER_CHAR.repeat(topLineWidth)

  // Prompt indicator
  const promptIcon = hasExclamation ? STATUS_ICONS.bash : STATUS_ICONS.user
  const promptColor = hasExclamation ? colors.bashBorder : colors.promptBorder

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Box flexDirection="row">
        <Text color={colors.promptBorder}>{topDashes}</Text>
        <Text color={resolvedModeColor}>{modeTag}</Text>
        {vimEnabled && <Text color={vimMode === 'normal' ? colors.warning : colors.textDim}>{vimLabel}</Text>}
        <Text color={colors.textDim}>{agentTag}</Text>
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

      {/* Bottom border */}
      <Text color={colors.promptBorder}>{DIVIDER_CHAR.repeat(Math.max(0, columns - 4))}</Text>
    </Box>
  )
}
