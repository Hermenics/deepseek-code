import { MODE_LABELS, MODE_COLORS, type InteractionMode } from '../../interactionMode.js'

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
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg="#888888">{dashes}</text>
        <text fg={resolvedModeColor}>{resolvedModeLabel}</text>
        {vimEnabled && <text fg={vimMode === 'normal' ? 'yellow' : '#888888'}>{vimLabel}</text>}
        <text fg="#888888">{label + '────'}</text>
      </box>

      <box flexDirection="row">
        {contextPct > 0 && (() => {
          const color = contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'cyan'
          return <text fg={color}>{contextPct + '% '}</text>
        })()}
        <text fg={hasExclamation ? 'magenta' : 'cyan'}>{hasExclamation ? '!' : '❯'}</text>
        <text>{' '}</text>
        {children}
      </box>

      <text fg="#888888">{'─'.repeat(columns - 8)}</text>
    </box>
  )
}
