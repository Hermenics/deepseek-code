import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'
import { TOOL_DISPLAY } from './toolDisplay.js'
import { MarkdownText } from './MarkdownText.js'
import pkg from '../../../package.json' with { type: 'json' }

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

function MessageItem({ message: m, theme, agentLabel }: { message: Message; theme: ThemeName; agentLabel: string }) {
  if (m.role === 'user') {
    return (
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg="cyan">{'❯'}</text>
          <text>{m.content}</text>
        </box>
      </box>
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
        <box flexDirection="row" paddingLeft={2} gap={1}>
          <text fg={isDone ? 'green' : 'yellow'}>{'⎿ '}</text>
          <text fg={isDone ? '#888888' : 'yellow'}>
            {labelTrunc || 'Agent'}{!isDone ? ' working...' : ''}
          </text>
        </box>
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
    return (
      <box flexDirection="column" paddingLeft={2}>
        <box flexDirection="row" gap={1}>
          <text fg="white">{'●'}</text>
          <text fg="white">{display}</text>
          {arg ? <text fg="#888888">{'(' + arg + ')'}</text> : null}
        </box>
        {trimmed.map((line, i) => (
          <box key={i} paddingLeft={2}>
            <text fg="#666666">{'⎿ '}</text>
            <text fg="#888888">{line}</text>
          </box>
        ))}
        {hasMore && (
          <box paddingLeft={2}>
            <text fg="#888888">{'⎿ ... ' + (outputLines.length - MAX_OUTPUT_LINES) + ' more lines'}</text>
          </box>
        )}
      </box>
    )
  }
  if (m.role === 'terminal') {
    return (
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg="magenta">{'$'}</text>
          <text fg="#aa55aa">terminal</text>
        </box>
        <box marginLeft={2}>
          <text>{m.content}</text>
        </box>
      </box>
    )
  }
  // assistant
  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row" gap={1}>
        <text fg="white">{'●'}</text>
        <box flexDirection="column" flexShrink={1}>
          <MarkdownText content={m.content} />
        </box>
      </box>
    </box>
  )
}

function Header({ provider, agentName }: { provider: string; agentName: string | null }) {
  const cols = process.stdout.columns ?? 80
  const isNarrow = cols < 60

  if (isNarrow) {
    return (
      <box flexDirection="column" marginLeft={1} marginTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg="cyan">{'◆ DeepSeek Code'}</text>
          <text fg="#888888">{'v' + pkg.version}</text>
        </box>
        {agentName && <text fg="cyan">{'[' + agentName + ']'}</text>}
        <text fg="#888888">{'/help  ·  /quit to exit'}</text>
      </box>
    )
  }

  return (
    <box flexDirection="row" gap={2} marginLeft={1} marginTop={1}>
      <box flexDirection="column">
        <text fg="cyan">{'  ▄▄███▄▄'}</text>
        <text fg="cyan">{' ▄█ ◉    ██▄'}</text>
        <text fg="cyan">{'█          ~~█'}</text>
        <text fg="cyan">{' ▀▄▄█▄▄▄▄█▀'}</text>
      </box>
      <box flexDirection="column">
        <box flexDirection="row" gap={1}>
          <text fg="cyan">{'◆ DeepSeek Code'}</text>
          <text fg="#888888">{'v' + pkg.version}</text>
          <text fg="#888888">{'·'}</text>
          <text fg="#888888">{provider}</text>
          {agentName && <>
            <text fg="#888888">{'·'}</text>
            <text fg="cyan">{'[' + agentName + ']'}</text>
          </>}
        </box>
        <box flexDirection="row" gap={1}>
          <text fg="#888888">cwd:</text>
          <text fg="#5599ff">{process.cwd()}</text>
        </box>
        <text fg="#888888">{'/help for commands  ·  /quit to exit'}</text>
      </box>
    </box>
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
    <box flexDirection="column" marginBottom={1}>
      <Header provider={headerProvider ?? 'deepseek'} agentName={headerAgent ?? null} />
      {messages.map((message, index) => (
        <MessageItem key={`${message.role}-${index}`} message={message} theme={theme} agentLabel={agentLabel} />
      ))}
      {thinkingText ? (
        <box flexDirection="column" marginTop={1} marginLeft={2}>
          <text fg="#666666"><i>{'Thinking: '}{thinkingText.length > 200 ? thinkingText.slice(-200) : thinkingText}</i></text>
        </box>
      ) : null}
      {streamText ? (
        <box flexDirection="column" marginTop={1}>
          {streamRole === 'terminal' ? (
            <>
              <box flexDirection="row" gap={1}>
                <text fg="magenta">{'$'}</text>
                <text fg="#aa55aa">terminal</text>
              </box>
              <box marginLeft={2}>
                <text>{streamText}</text>
              </box>
            </>
          ) : (
            <box flexDirection="row" gap={1}>
              <text fg="white">{'●'}</text>
              <box flexDirection="column" flexShrink={1}>
                <MarkdownText content={streamText} streaming />
              </box>
            </box>
          )}
        </box>
      ) : null}
    </box>
  )
}
