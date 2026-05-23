import React from 'react'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'
import { TOOL_DISPLAY, TOOL_STYLE } from './toolDisplay.js'
import { MarkdownText } from './MarkdownText.js'
import pkg from '../../../package.json' with { type: 'json' }
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

function formatToolLine(rawName: string, detail: string): { display: string; arg: string; output: string } {
  const display = TOOL_DISPLAY[rawName] ?? rawName
  let arg = ''
  let output = ''
  try {
    const parsed = JSON.parse(detail)
    if (parsed && typeof parsed === 'object' && 'arg' in parsed) {
      const plainArg = String(parsed.arg ?? '')
      arg = plainArg.length > 60 ? plainArg.slice(0, 60) + '...' : plainArg
      output = String(parsed.output ?? '')
    } else {
      arg = detail.length > 60 ? detail.slice(0, 60) + '...' : detail
    }
  } catch {
    arg = detail.length > 60 ? detail.slice(0, 60) + '...' : detail
  }
  return { display, arg, output }
}

function MessageItem({ message: m, theme, agentLabel }: { message: Message; theme: ThemeName; agentLabel: string; key?: React.Key }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="cyan">{'❯'}</Text>
          <Text>{m.content}</Text>
        </Box>
      </Box>
    )
  }
  if (m.role === 'tool') {
    if (m.content.startsWith('✓ write_file →')) {
      try {
        const json = JSON.parse(m.content.slice('✓ write_file → '.length))
        if (json.__diff) {
          return <DiffView path={json.path} added={json.added} removed={json.removed} firstChanged={json.firstChanged} lines={json.lines} theme={theme} />
        }
      } catch { /* not JSON */ }
    }
    if (m.content.startsWith('✓ subagent →') || m.content.startsWith('⚙ subagent')) {
      const isDone = m.content.startsWith('✓')
      const label = isDone ? m.content.slice('✓ subagent → '.length) : m.content.slice('⚙ subagent('.length, -1)
      const labelTrunc = label.length > 60 ? label.slice(0, 60) + '...' : label
      return (
        <Box flexDirection="row" paddingLeft={2} gap={1}>
          <Text color={isDone ? 'green' : 'yellow'}>{'⎿ '}</Text>
          <Text color={isDone ? '#888888' : 'yellow'}>
            {labelTrunc || 'Agent'}{!isDone ? ' working...' : ''}
          </Text>
        </Box>
      )
    }
    const raw = m.content.slice(2)
    const sep = raw.indexOf(' → ')
    const toolName = sep >= 0 ? raw.slice(0, sep) : raw
    const detail = sep >= 0 ? raw.slice(sep + 3) : ''
    const { display, arg, output } = formatToolLine(toolName, detail)
    const outputLines = output ? output.split(/\r?\n/).filter(Boolean) : []
    const MAX_OUTPUT_LINES = 5
    const trimmed = outputLines.slice(0, MAX_OUTPUT_LINES)
    const hasMore = outputLines.length > MAX_OUTPUT_LINES
    const style = TOOL_STYLE[display] || { icon: '▸', color: '#888888' }
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box flexDirection="row" gap={1}>
          <Text color={style.color}>{style.icon}</Text>
          <Text color={style.color}>{display}</Text>
          {arg ? <Text color="#666666">{arg}</Text> : null}
        </Box>
        {trimmed.map((line, i) => (
          <Box key={i} paddingLeft={3}>
            <Text color="#555555">{line}</Text>
          </Box>
        ))}
        {hasMore && (
          <Box paddingLeft={3}>
            <Text color="#555555">{'… ' + (outputLines.length - MAX_OUTPUT_LINES) + ' more lines'}</Text>
          </Box>
        )}
      </Box>
    )
  }
  if (m.role === 'terminal') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="magenta">{'$'}</Text>
          <Text color="#aa55aa">terminal</Text>
        </Box>
        <Box marginLeft={2}>
          <Text>{m.content}</Text>
        </Box>
      </Box>
    )
  }
  if (m.role === 'thinking') {
    return (
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Box flexDirection="row" gap={1}>
          <Text color="#666666">{'◌'}</Text>
          <Text color="#666666" italic>{'Thinking'}</Text>
        </Box>
        <Box marginLeft={1} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor="#111118">
          <Box flexShrink={1}>
            <MarkdownText content={m.content} dimmed />
          </Box>
        </Box>
      </Box>
    )
  }
  // assistant
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text color="white">{'●'}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <MarkdownText content={m.content} />
        </Box>
      </Box>
    </Box>
  )
}

function Header({ provider, agentName }: { provider: string; agentName: string | null }) {
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 60

  if (isNarrow) {
    return (
      <Box flexDirection="column" marginLeft={1} marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="cyan">{'◆ DeepSeek Code'}</Text>
          <Text color="#888888">{'v' + pkg.version}</Text>
        </Box>
        {agentName && <Text color="cyan">{'[' + agentName + ']'}</Text>}
        <Text color="#888888">{'/help  ·  /quit to exit'}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" gap={2} marginLeft={1} marginTop={1}>
      <Box flexDirection="column">
        <Text color="cyan">{'  ▄▄███▄▄'}</Text>
        <Text color="cyan">{' ▄█ ◉    ██▄'}</Text>
        <Text color="cyan">{'█          ~~█'}</Text>
        <Text color="cyan">{' ▀▄▄█▄▄▄▄█▀'}</Text>
      </Box>
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="cyan">{'◆ DeepSeek Code'}</Text>
          <Text color="#888888">{'v' + pkg.version}</Text>
          <Text color="#888888">{'·'}</Text>
          <Text color="#888888">{provider}</Text>
          {agentName && <>
            <Text color="#888888">{'·'}</Text>
            <Text color="cyan">{'[' + agentName + ']'}</Text>
          </>}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="#888888">cwd:</Text>
          <Text color="#5599ff">{process.cwd()}</Text>
        </Box>
        <Text color="#888888">{'/help for commands  ·  /quit to exit'}</Text>
      </Box>
    </Box>
  )
}

export function MessageList({ messages, streamText, thinkingText, streamRole = 'assistant', theme, activeAgent, headerProvider, headerAgent }: {
  messages: Message[]
  streamText: string
  thinkingText?: string
  streamRole?: 'assistant' | 'terminal'
  theme: ThemeName
  activeAgent?: string | null
  headerProvider?: string
  headerAgent?: string | null
}) {
  const agentLabel = activeAgent ?? 'deepseek'

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Header provider={headerProvider ?? 'deepseek'} agentName={headerAgent ?? null} />
      {messages.map((message, index) => (
        <MessageItem key={`${message.role}-${index}`} message={message} theme={theme} agentLabel={agentLabel} />
      ))}
      {thinkingText ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Box flexDirection="row" gap={1}>
            <Text color="#666666">{'◌'}</Text>
            <Text color="#666666" italic>{'Thinking'}</Text>
          </Box>
          <Box marginLeft={1} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} backgroundColor="#111118">
            <Box flexShrink={1}>
              <MarkdownText content={thinkingText} dimmed />
            </Box>
          </Box>
        </Box>
      ) : null}
      {streamText ? (
        <Box flexDirection="column" marginTop={1}>
          {streamRole === 'terminal' ? (
            <>
              <Box flexDirection="row" gap={1}>
                <Text color="magenta">{'$'}</Text>
                <Text color="#aa55aa">terminal</Text>
              </Box>
              <Box marginLeft={2}>
                <Text>{streamText}</Text>
              </Box>
            </>
          ) : (
            <Box flexDirection="row" gap={1}>
              <Text color="white">{'●'}</Text>
              <Box flexDirection="column" flexShrink={1}>
                <MarkdownText content={streamText} streaming />
              </Box>
            </Box>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
