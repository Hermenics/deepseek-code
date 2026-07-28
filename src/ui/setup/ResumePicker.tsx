import { useContext, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { Key } from '../../ink/events/input-event.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { getThemeColors, type ThemeName } from '../theme.js'
import type { SessionData } from '../../agent/session.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'

function firstMessage(session: SessionData, role: 'user' | 'assistant'): string {
  return session.uiMessages.find(message => message.role === role)?.content?.trim().replace(/\s+/g, ' ') ?? ''
}

function title(session: SessionData, width: number): string {
  return (session.title || firstMessage(session, 'user')).slice(0, Math.max(8, width - 8)) || 'New conversation'
}

function preview(session: SessionData): string {
  const message = firstMessage(session, 'assistant')
  return message ? `↳ ${message.slice(0, 92)}` : '↳ No assistant response yet'
}

function updatedAt(session: SessionData): string {
  return new Date(session.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(1, width - 1))}…` : value
}

export function ResumePicker({
  sessions,
  theme,
  onSelect,
  onCancel,
}: {
  sessions: SessionData[]
  theme: ThemeName
  onSelect: (session: SessionData) => void
  onCancel: () => void
}) {
  const [index, setIndex] = useState(0)
  const colors = getThemeColors(theme)
  const terminalSize = useContext(TerminalSizeContext)
  const columns = terminalSize?.columns ?? process.stdout.columns ?? 100
  const rows = terminalSize?.rows ?? process.stdout.rows ?? 24
  const width = Math.min(Math.max(columns - 4, 20), 104)
  const ultraCompact = rows < 20
  const compact = rows < 30
  const maxVisible = compact ? 1 + Math.max(0, Math.floor((rows - 19) / 3)) : 1 + Math.max(0, Math.floor((rows - 26) / 3))
  const start = Math.min(Math.max(index - maxVisible + 1, 0), Math.max(0, sessions.length - maxVisible))
  const visibleSessions = sessions.slice(start, start + maxVisible)
  const project = process.cwd().split('/').filter(Boolean).pop() ?? process.cwd()
  const selected = sessions[index]!

  useInput((input: string, key: Key) => {
    if (key.upArrow) { setIndex(i => (i - 1 + sessions.length) % sessions.length); return }
    if (key.downArrow) { setIndex(i => (i + 1) % sessions.length); return }
    if (key.return) { onSelect(selected); return }
    if (key.escape || (key.ctrl && input === 'c')) onCancel()
  })

  if (ultraCompact) {
    return <Box><Text color={colors.primary} bold>Resume {index + 1}/{sessions.length}: </Text><Text>{truncate(title(selected, width), Math.max(8, columns - 25))}</Text><Text color={colors.textDim}> · ↑↓ Enter Esc</Text></Box>
  }

  return (
    <Box flexDirection="column" alignItems="center" paddingTop={1}>
      <Box width={width} flexDirection="column" borderStyle="round" borderColor={colors.primary} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column">
            <Text color={colors.primary} bold>{'Resume a previous session'}</Text>
            {!compact && <Text color={colors.textDim}>Recent conversations in <Text color={colors.text}>{truncate(project, width - 38)}</Text></Text>}
          </Box>
          <Text color={colors.textDim}>{sessions.length} saved</Text>
        </Box>

        {!compact && <Box marginTop={1} borderStyle="single" borderColor={colors.rule} paddingLeft={1} paddingRight={1}>
          <Text color={colors.textDim}>⌁ {truncate(process.cwd(), width - 8)}</Text>
        </Box>}

        <Box flexDirection="column" marginTop={1}>
          {visibleSessions.map((session, offset) => {
            const i = start + offset
            const active = i === index
            return (
              <Box key={session.id} flexDirection="column" borderStyle={active ? 'round' : undefined} borderColor={active ? colors.primary : undefined} paddingLeft={active ? 1 : 2} paddingRight={1} paddingTop={active ? 0 : 1} paddingBottom={active ? 0 : 0}>
                <Text color={active ? colors.primary : colors.text} bold={active}>{active ? '› ' : '  '}{title(session, width)}</Text>
                <Text color={colors.textDim}>{'   '}{truncate(`${updatedAt(session)} · ${session.model} · ${session.id}`, width - 8)}</Text>
                {active && !compact && <Text color={colors.textSubtle}>{truncate(`   ${preview(session)}`, width - 8)}</Text>}
              </Box>
            )
          })}
        </Box>

        <Box marginTop={1} borderTop borderColor={colors.rule} paddingTop={1} justifyContent="space-between">
          <Text color={colors.textDim}>↑↓ select  ·  Enter resume{start > 0 || start + maxVisible < sessions.length ? `  ·  ${start + 1}–${Math.min(start + maxVisible, sessions.length)}/${sessions.length}` : ''}</Text>
          {!compact && <Text color={colors.textDim}>Esc new session</Text>}
        </Box>
      </Box>
    </Box>
  )
}
