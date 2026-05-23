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
  children,
}: InputChromeProps) {
  const resolvedModeLabel = modeLabel || `[${MODE_LABELS[interactionMode as InteractionMode]}]`
  const resolvedModeColor = modeColor || MODE_COLORS[interactionMode as InteractionMode]
  const vimLabel = vimEnabled ? (vimMode === 'normal' ? ' [N]' : ' [I]') : ''
  const label = ` ${agentLabel} `
  const suffix = resolvedModeLabel + vimLabel + label + '────'
  const leftDashes = Math.max(0, columns - 8 - suffix.length)
  const dashes = '─'.repeat(leftDashes)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="#888888">{dashes}</Text>
        <Text color={resolvedModeColor}>{resolvedModeLabel}</Text>
        {vimEnabled && <Text color={vimMode === 'normal' ? 'yellow' : '#888888'}>{vimLabel}</Text>}
        <Text color="#888888">{label + '────'}</Text>
      </Box>

      <Box flexDirection="row">
        {contextPct > 0 && (() => {
          const color = contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'cyan'
          return <Text color={color}>{contextPct + '% '}</Text>
        })()}
        <Text color={hasExclamation ? 'magenta' : 'cyan'}>{hasExclamation ? '!' : '❯'}</Text>
        <Text>{' '}</Text>
        {children}
      </Box>

      <Text color="#888888">{'─'.repeat(columns - 8)}</Text>
    </Box>
  )
}
