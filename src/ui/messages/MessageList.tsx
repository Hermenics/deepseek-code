import React from 'react'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import { DiffFileList, type DiffFileSummary } from './DiffFileList.js'
import type { DiffLine } from './DiffDialog.js'
import { summarizeAskUserPayload, summarizeToolPayload, TOOL_DISPLAY, TOOL_STYLE } from './toolDisplay.js'
import { MarkdownText } from './MarkdownText.js'
import { DIVIDER_CHAR, getThemeColors, STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import pkg from '../../../package.json' with { type: 'json' }
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { useClock } from '../clock.js'

export function formatToolLine(rawName: string, detail: string, full = false): { display: string; arg: string; output: string } {
  const display = TOOL_DISPLAY[rawName] ?? rawName
  if (rawName === 'ask_user_questions') {
    return { display, arg: summarizeAskUserPayload(detail), output: '' }
  }
  let arg = ''
  let output = ''
  const truncate = (value: string) => (!full && value.length > 60) ? value.slice(0, 60) + '...' : value
  try {
    const parsed = JSON.parse(detail)
    if (parsed && typeof parsed === 'object' && 'arg' in parsed) {
      arg = truncate(String(parsed.arg ?? ''))
      output = String(parsed.output ?? '')
    } else if (parsed && typeof parsed === 'object') {
      arg = summarizeToolPayload(rawName, detail)
    } else {
      arg = truncate(detail)
    }
  } catch {
    arg = truncate(detail)
  }
  return { display, arg, output }
}

/** Mirrors Codex: divide only a final reply that follows concrete tool work. */
export function shouldShowWorkDivider(messages: Message[], index: number): boolean {
  if (messages[index]?.role !== 'assistant') return false
  for (let previous = index - 1; previous >= 0; previous--) {
    const role = messages[previous]!.role
    if (role === 'tool') return true
    if (role === 'user' || role === 'assistant') return false
  }
  return false
}

export const WORK_TRUNCATED_LABEL = 'Work truncated (ctrl+o to expand)'

export function formatWorkedDuration(workedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(workedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function workedLine(workedMs: number, width = process.stdout.columns ?? 80): string {
  const targetWidth = Math.max(1, width - 1)
  const prefix = `
  ─ Worked for ${formatWorkedDuration(workedMs)} `
  return prefix + '─'.repeat(Math.max(1, targetWidth - prefix.length))
}

export function dividerLine(label = '', width = process.stdout.columns ?? 80): string {
  const targetWidth = Math.max(1, width - 1)
  const visibleLabel = label.slice(0, targetWidth)
  if (!visibleLabel) return DIVIDER_CHAR.repeat(targetWidth)
  const dashes = Math.max(0, targetWidth - visibleLabel.length)
  const left = Math.ceil(dashes / 2)
  return `${DIVIDER_CHAR.repeat(left)}${visibleLabel}${DIVIDER_CHAR.repeat(dashes - left)}`
}

type DisplayMessage = { kind: 'message'; message: Message; index: number } | { kind: 'truncated'; index: number }

function isWorkMessage(message: Message): boolean {
  return message.role === 'tool' || message.role === 'terminal'
}

/** Keeps the user's request and final reply visible while Ctrl+O expands the work transcript. */
export function getNormalMessageItems(messages: Message[]): DisplayMessage[] {
  const result: DisplayMessage[] = []
  let cursor = 0
  while (cursor < messages.length) {
    if (messages[cursor]!.role !== 'user') {
      result.push({ kind: 'message', message: messages[cursor]!, index: cursor++ })
      continue
    }
    const nextUser = messages.findIndex((message, index) => index > cursor && message.role === 'user')
    const end = nextUser < 0 ? messages.length : nextUser
    const lastAssistant = messages.slice(cursor + 1, end).reduce((last, message, offset) => message.role === 'assistant' ? cursor + 1 + offset : last, -1)
    const hasWork = messages.slice(cursor + 1, end).some(isWorkMessage)
    result.push({ kind: 'message', message: messages[cursor]!, index: cursor })
    if (hasWork && lastAssistant > cursor && messages[lastAssistant]!.workedMs != null) {
      result.push({ kind: 'truncated', index: lastAssistant })
      result.push({ kind: 'message', message: messages[lastAssistant]!, index: lastAssistant })
      cursor = end
    } else {
      for (let index = cursor + 1; index < end; index++) result.push({ kind: 'message', message: messages[index]!, index })
      cursor = end
    }
  }
  return result
}

function WorkDivider({ theme }: { theme: ThemeName }) {
  const colors = getThemeColors(theme)
  return <Box marginTop={1}><Text color={colors.textSubtle}>{dividerLine()}</Text></Box>
}

export interface DiffPayload {
  path: string
  added: number
  removed: number
  firstChanged: number
  lines: DiffLine[]
}

export function getDiffPayload(content: string): DiffPayload | null {
  const prefix = content.startsWith('✓ write_file →') ? '✓ write_file → '
    : content.startsWith('✓ patch_file →') ? '✓ patch_file → '
    : null
  if (!prefix) return null

  try {
    const diff: unknown = JSON.parse(content.slice(prefix.length))
    if (!diff || typeof diff !== 'object') return null
    const payload = diff as Record<string, unknown>
    const validNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    const validLine = (line: unknown) => {
      if (!line || typeof line !== 'object') return false
      const value = line as Record<string, unknown>
      return (value.type === 'added' || value.type === 'removed' || value.type === 'context')
        && typeof value.text === 'string'
        && validNumber(value.lineNo)
    }
    if (payload.__diff !== true || typeof payload.path !== 'string'
      || !validNumber(payload.added) || !validNumber(payload.removed) || !validNumber(payload.firstChanged)
      || !Array.isArray(payload.lines) || !payload.lines.every(validLine)) return null
    return payload as unknown as DiffPayload
  } catch {
    return null
  }
}

function MessageItem({ message: m, theme, agentLabel: _agentLabel, showDiffs = true, showWordDiff = true, compact = false, fullMode = false, onOpenDiff }: {
  message: Message
  theme: ThemeName
  agentLabel: string
  showDiffs?: boolean
  showWordDiff?: boolean
  compact?: boolean
  fullMode?: boolean
  onOpenDiff?: (diff: Pick<DiffPayload, 'path' | 'lines'>) => void
  key?: React.Key
}) {
  const colors = getThemeColors(theme)
  const marginTop = compact ? 0 : 1

  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginTop={marginTop}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.primary}>{STATUS_ICONS.user}</Text>
          <Text color={colors.text}>{m.content}</Text>
        </Box>
      </Box>
    )
  }

  if (m.role === 'tool') {
    const diff = getDiffPayload(m.content)
    if (diff) {
      if (!showDiffs) {
        return (
          <Box flexDirection="row" paddingLeft={2} gap={1}>
            <Text color={colors.success}>{STATUS_ICONS.assistant}</Text>
            <Text color={colors.textDim}>{m.content.startsWith('✓ patch_file') ? 'patch' : 'write'} {diff.path} (+{diff.added} −{diff.removed}) · diff hidden</Text>
          </Box>
        )
      }
      return <DiffView {...diff} theme={theme} showWordDiff={showWordDiff} onOpen={() => onOpenDiff?.(diff)} />
    }
    if (m.content.startsWith('✓ subagent →') || m.content.startsWith('⚙ subagent')) {
      const isDone = m.content.startsWith('✓')
      const label = isDone ? m.content.slice('✓ subagent → '.length) : m.content.slice('⚙ subagent('.length, -1)
      const labelTrunc = label.length > 60 ? label.slice(0, 60) + '...' : label
      return (
        <Box flexDirection="row" paddingLeft={2} gap={1}>
          <Text color={isDone ? colors.success : colors.warning}>{STATUS_ICONS.assistant}</Text>
          <Text color={isDone ? colors.textDim : colors.warning}>
            {labelTrunc || 'Agent'}{!isDone ? ' working...' : ''}
          </Text>
        </Box>
      )
    }
    const raw = m.content.slice(2)
    const sep = raw.indexOf(' → ')
    const toolName = sep >= 0 ? raw.slice(0, sep) : raw
    const detail = sep >= 0 ? raw.slice(sep + 3) : ''
    const { display, arg, output } = formatToolLine(toolName, detail, fullMode)
    const outputLines = output ? output.split(/\r?\n/).filter(Boolean) : []
    const MAX_OUTPUT_LINES = 5
    const trimmed = fullMode ? outputLines : outputLines.slice(0, MAX_OUTPUT_LINES)
    const hasMore = !fullMode && outputLines.length > MAX_OUTPUT_LINES
    const style = TOOL_STYLE[display] || { icon: '▸', color: colors.textDim }
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.success}>{STATUS_ICONS.assistant}</Text>
          <Text color={style.color}>{display}</Text>
          {arg ? <Text color={colors.textSubtle}>{arg}</Text> : null}
        </Box>
        {trimmed.map((line, i) => (
          <Box key={i} paddingLeft={3}>
            <Text color={colors.textSubtle}>{line}</Text>
          </Box>
        ))}
        {hasMore && (
          <Box paddingLeft={3}>
            <Text color={colors.textSubtle}>{'… ' + (outputLines.length - MAX_OUTPUT_LINES) + ' more lines'}</Text>
          </Box>
        )}
      </Box>
    )
  }

  if (m.role === 'terminal') {
    return (
      <Box flexDirection="column" marginTop={marginTop}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.bashBorder}>{STATUS_ICONS.terminal}</Text>
          <Text color={colors.bashBorder}>terminal</Text>
        </Box>
        <Box marginLeft={2}>
          <Text color={colors.text}>{m.content}</Text>
        </Box>
      </Box>
    )
  }

  if (m.role === 'thinking') {
    if (!fullMode) {
      return (
        <Box flexDirection="row" marginTop={marginTop} marginLeft={2} gap={1}>
          <Text color={colors.textSubtle}>{STATUS_ICONS.thinking}</Text>
          <Text color={colors.textSubtle}>{m.thinkingMs != null ? 'Thought for ' + Math.round(m.thinkingMs / 1000) + ' seconds (ctrl+o to expand)' : 'Thought (ctrl+o to expand)'}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" marginTop={marginTop} marginLeft={2}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.textSubtle}>{STATUS_ICONS.thinking}</Text>
          <Text color={colors.textSubtle} italic>{'Thinking'}</Text>
        </Box>
        <Box marginLeft={1} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={colors.thinkingBg}>
          <Box flexShrink={1}>
            <MarkdownText content={m.content} dimmed theme={theme} />
          </Box>
        </Box>
      </Box>
    )
  }

  // assistant
  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Box flexDirection="row" gap={1}>
        <Text color={colors.suggestion}>{STATUS_ICONS.assistant}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <MarkdownText content={m.content} theme={theme} />
        </Box>
      </Box>
    </Box>
  )
}

function Header({ provider, agentName, theme = 'dark' }: { provider: string; agentName: string | null; theme?: ThemeName }) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 60

  if (isNarrow) {
    return (
      <Box flexDirection="column" marginLeft={1} marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.primary}>{STATUS_ICONS.agent + ' DeepSeek Code'}</Text>
          <Text color={colors.textDim}>{'v' + pkg.version}</Text>
        </Box>
        {agentName && <Text color={colors.primary}>{'[' + agentName + ']'}</Text>}
        <Text color={colors.textDim}>{'/help  ·  /quit to exit'}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" gap={2} marginLeft={1} marginTop={1}>
      <Box flexDirection="column">
        <Text color={colors.primary}>{'  ▄▄███▄▄'}</Text>
        <Text color={colors.primary}>{' ▄█ ◉    ██▄'}</Text>
        <Text color={colors.primary}>{'█          ~~█'}</Text>
        <Text color={colors.primary}>{' ▀▄▄█▄▄▄▄█▀'}</Text>
      </Box>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={colors.primary}>{STATUS_ICONS.agent + ' DeepSeek Code'}</Text>
          <Text color={colors.textDim}>{'v' + pkg.version}</Text>
          <Text color={colors.textDim}>{'·'}</Text>
          <Text color={colors.textDim}>{provider}</Text>
          {agentName && <>
            <Text color={colors.textDim}>{'·'}</Text>
            <Text color={colors.primary}>{'[' + agentName + ']'}</Text>
          </>}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.textDim}>cwd:</Text>
          <Text color={colors.primary}>{process.cwd()}</Text>
        </Box>
        <Text color={colors.textDim}>{'/help for commands  ·  /quit to exit'}</Text>
      </Box>
    </Box>
  )
}

export function MessageList({ messages, streamText, thinkingText, streamRole = 'assistant', theme, activeAgent, headerProvider, headerAgent, showToolCalls = true, showDiffs = true, showWordDiff = true, density = 'comfortable', fullMode = false, thinkingStartedAt = null, onOpenDiff }: {
  messages: Message[]
  streamText: string
  thinkingText?: string
  streamRole?: 'assistant' | 'terminal'
  theme: ThemeName
  activeAgent?: string | null
  headerProvider?: string
  headerAgent?: string | null
  showToolCalls?: boolean
  showDiffs?: boolean
  showWordDiff?: boolean
  density?: 'compact' | 'comfortable'
  fullMode?: boolean
  thinkingStartedAt?: number | null
  onOpenDiff?: (diff: Pick<DiffPayload, 'path' | 'lines'>) => void
}) {
  const colors = getThemeColors(theme)
  const agentLabel = activeAgent ?? 'deepseek'
  const diffFiles = new Map<string, DiffFileSummary>()
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const diff = getDiffPayload(message.content)
    if (!diff) continue
    const current = diffFiles.get(diff.path) ?? { path: diff.path, added: 0, removed: 0 }
    current.added += diff.added
    current.removed += diff.removed
    diffFiles.set(diff.path, current)
  }
  const displayMessages = fullMode
    ? messages.map((message, index): DisplayMessage => ({ kind: 'message', message, index }))
    : getNormalMessageItems(messages)

  return (
    <Box flexDirection="column" marginBottom={density === 'compact' ? 0 : 1}>
      <Header provider={headerProvider ?? 'deepseek'} agentName={headerAgent ?? null} theme={theme} />
      {displayMessages.map((item) => {
        if (item.kind === 'truncated') {
          return <Box key={`truncated-${item.index}`} marginTop={1}><Text color={colors.textSubtle}>{dividerLine(WORK_TRUNCATED_LABEL)}</Text></Box>
        }
        const { message, index } = item
        if (message.role === 'tool' && !showToolCalls) return null
        const showDivider = fullMode && showToolCalls && shouldShowWorkDivider(messages, index)
        return (
          <Box key={`${message.role}-${index}`} flexDirection="column">
            {showDivider && <WorkDivider theme={theme} />}
            <MessageItem message={message} theme={theme} agentLabel={agentLabel} showDiffs={showDiffs} showWordDiff={showWordDiff} compact={showDivider || density === 'compact'} fullMode={fullMode} onOpenDiff={onOpenDiff} />
            {message.role === 'assistant' && message.workedMs != null && (
              <Text color={colors.textSubtle}>{workedLine(message.workedMs)}</Text>
            )}
          </Box>
        )
      })}
      {diffFiles.size > 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Text color={colors.textDim}>Changed files · Ctrl+D opens the latest diff</Text>
          <DiffFileList files={[...diffFiles.values()]} theme={theme} />
        </Box>
      )}
      {thinkingText ? <LiveThinking content={thinkingText} fullMode={fullMode} startedAt={thinkingStartedAt} theme={theme} /> : null}
      {streamText ? (
        <Box flexDirection="column" marginTop={1}>
          {streamRole === 'terminal' ? (
            <>
              <Box flexDirection="row" gap={1}>
                <Text color={colors.bashBorder}>{STATUS_ICONS.terminal}</Text>
                <Text color={colors.bashBorder}>terminal</Text>
              </Box>
              <Box marginLeft={2}>
                <Text color={colors.text}>{streamText}</Text>
              </Box>
            </>
          ) : (
            <Box flexDirection="row" gap={1}>
              <Text color={colors.suggestion}>{STATUS_ICONS.assistant}</Text>
              <Box flexDirection="column" flexShrink={1}>
                <MarkdownText content={streamText} streaming theme={theme} />
              </Box>
            </Box>
          )}
        </Box>
      ) : null}
      {fullMode && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.textSubtle}>{dividerLine()}</Text>
          <Box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
            <Text color={colors.textSubtle}>{'Full mode · ctrl+o to toggle'}</Text>
            <Text color={colors.textSubtle}>{'verbose'}</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function LiveThinking({ content, fullMode, startedAt, theme }: {
  content: string
  fullMode: boolean
  startedAt: number | null
  theme: ThemeName
}) {
  const colors = getThemeColors(theme)
  // Read the clock tick each render so the live counter advances as time passes
  useClock()
  if (fullMode) {
    return (
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.textSubtle}>{STATUS_ICONS.thinking}</Text>
          <Text color={colors.textSubtle} italic>{'Thinking'}</Text>
        </Box>
        <Box marginLeft={1} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor={colors.thinkingBg}>
          <Box flexShrink={1}>
            <MarkdownText content={content} dimmed theme={theme} />
          </Box>
        </Box>
      </Box>
    )
  }
  if (startedAt == null) {
    // No start timestamp — render a generic live indicator instead of
    // calculating from epoch zero (would show billions of seconds).
    return (
      <Box flexDirection="row" marginTop={1} marginLeft={2} gap={1}>
        <Text color={colors.textSubtle}>{STATUS_ICONS.thinking}</Text>
        <Text color={colors.textSubtle}>{'Thinking...'}</Text>
      </Box>
    )
  }
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  return (
    <Box flexDirection="row" marginTop={1} marginLeft={2} gap={1}>
      <Text color={colors.textSubtle}>{STATUS_ICONS.thinking}</Text>
      <Text color={colors.textSubtle}>{'Thinking for ' + seconds + ' seconds...'}</Text>
    </Box>
  )
}
