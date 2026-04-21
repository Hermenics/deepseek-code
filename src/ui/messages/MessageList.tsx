import React from 'react'
import { Box, Text, Static } from 'ink'
import figures from 'figures'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'
import { DeepSeekMascot } from '../layout/Mascot.js'
import pkg from '../../../package.json' with { type: 'json' }


/**
 * Sanitizes incomplete streaming text for safe markdown rendering.
 * Closes unclosed code fences and collapses excessive blank lines
 * that the marked lexer would otherwise turn into empty space.
 */
function sanitizeStreamMarkdown(text: string): string {
  // Collapse 3+ consecutive newlines into 2 (prevents huge gaps)
  let sanitized = text.replace(/\n{3,}/g, '\n\n')
  // Close unclosed code fences so marked doesn't produce broken output
  const fenceCount = (sanitized.match(/^```/gm) || []).length
  if (fenceCount % 2 !== 0) {
    sanitized += '\n```'
  }
  return sanitized
}

// Maps internal tool names → display names (Claude Code style)
const TOOL_DISPLAY: Record<string, string> = {
  read_file:        'Read',
  write_file:       'Write',
  patch_file:       'Edit',
  read_folder:      'List',
  shell:            'Bash',
  grep:             'Grep',
  glob:             'Glob',
  web_fetch:        'WebFetch',
  subagent:         'Agent',
  git:              'Git',
  introspect:       'Introspect',
  update_knowledge: 'UpdateKnowledge',
  todo:             'TodoWrite',
}


// Splits text by \n into individual <Text> elements inside a column <Box>,
// preventing Ink from rendering newlines outside the parent component bounds.
// Uses wrap-ansi to prevent text overflow on narrow terminals.
export function renderLines(text: string): React.ReactNode {
  const cols = Math.max((process.stdout.columns ?? 80) - 6, 30)
  const rawLines = text.split(/\r?\n/)
  // Only apply wrap-ansi to lines that actually exceed terminal width
  const lines: string[] = []
  for (const line of rawLines) {
    if (stripAnsi(line).length > cols) {
      lines.push(...wrapAnsi(line, cols, { hard: true }).split('\n'))
    } else {
      lines.push(line)
    }
  }
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  )
}

function formatToolLine(rawName: string, detail: string): { display: string; arg: string; output: string } {
  const display = TOOL_DISPLAY[rawName] ?? rawName
  let arg = ''
  let output = ''
  try {
    const parsed = JSON.parse(detail)
    if (parsed && typeof parsed === 'object' && 'arg' in parsed) {
      const plainArg = stripAnsi(String(parsed.arg ?? ''))
      arg = plainArg.length > 60 ? parsed.arg.slice(0, 60) + '…' : String(parsed.arg ?? '')
      output = String(parsed.output ?? '')
    } else {
      const plain = stripAnsi(detail)
      arg = plain.length > 60 ? detail.slice(0, 60) + '…' : detail
    }
  } catch {
    const plain = stripAnsi(detail)
    arg = plain.length > 60 ? detail.slice(0, 60) + '…' : detail
  }
  return { display, arg, output }
}

function MessageItem({ message: m, theme, agentLabel }: { message: Message; theme: ThemeName; agentLabel: string }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color="cyan" bold>{figures.pointer}</Text>
          {renderLines(m.content)}
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
      const labelTrunc = label.length > 60 ? label.slice(0, 60) + '…' : label
      return (
        <Box paddingLeft={2} gap={1}>
          <Text color={isDone ? 'green' : 'yellow'}>⎿ </Text>
          <Text color={isDone ? 'white' : 'yellow'} dimColor={isDone}>
            {labelTrunc || 'Agent'}{!isDone ? ' working…' : ''}
          </Text>
        </Box>
      )
    }
    const raw = m.content.slice(2) // strip "✓ " or "⚙ "
    const sep = raw.indexOf(' → ')
    const toolName = sep >= 0 ? raw.slice(0, sep) : raw
    const detail = sep >= 0 ? raw.slice(sep + 3) : ''
    const { display, arg, output } = formatToolLine(toolName, detail)
    const outputLines = output ? output.split(/\r?\n/).filter(Boolean) : []
    const MAX_OUTPUT_LINES = 5
    const trimmed = outputLines.slice(0, MAX_OUTPUT_LINES)
    const hasMore = outputLines.length > MAX_OUTPUT_LINES
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box gap={1}>
          <Text color="green" bold>{figures.circleFilled}</Text>
          <Text bold>{display}</Text>
          {arg ? <Text dimColor>({arg})</Text> : null}
        </Box>
        {trimmed.map((line, i) => (
          <Box key={i} paddingLeft={2}>
            <Text color="cyan" dimColor>⎿ </Text>
            <Text dimColor>{line}</Text>
          </Box>
        ))}
        {hasMore && (
          <Box paddingLeft={2}>
            <Text dimColor>⎿ … {outputLines.length - MAX_OUTPUT_LINES} more lines</Text>
          </Box>
        )}
      </Box>
    )
  }
  // terminal (shell execution with !)
  if (m.role === 'terminal') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1} alignItems="flex-start">
          <Text color="magenta" bold>$</Text>
          <Text color="magenta" dimColor>terminal</Text>
        </Box>
        <Box marginLeft={2}>
          {renderLines(m.content)}
        </Box>
      </Box>
    )
  }
  // assistant
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1} alignItems="flex-start">
        <Text color="green" bold>{figures.circleFilled}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <MarkdownRenderer content={m.content} theme={theme} />
        </Box>
      </Box>
    </Box>
  )
}

type StaticItem =
  | { kind: 'header'; provider: string; agentName: string | null }
  | { kind: 'message'; message: Message; index: number }

export function MessageList({ messages, streamText, streamRole = 'assistant', theme, activeAgent, headerProvider, headerAgent }: {
  messages: Message[]
  streamText: string
  streamRole?: 'assistant' | 'terminal'
  theme: ThemeName
  activeAgent?: string | null
  headerProvider?: string
  headerAgent?: string | null
}) {
  const agentLabel = activeAgent ?? 'deepseek'

  const items: StaticItem[] = [
    { kind: 'header', provider: headerProvider ?? 'deepseek', agentName: headerAgent ?? null },
    ...messages.map((message, index) => ({ kind: 'message' as const, message, index })),
  ]

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Static items={items}>
        {(item) => {
          if (item.kind === 'header') {
            const cols = process.stdout.columns ?? 80
            const isNarrow = cols < 60
            return (
              <Box key="header" flexDirection="column" marginX={1} marginTop={1}>
                {isNarrow ? (
                  // Compact version for narrow terminals
                  <Box flexDirection="column">
                    <Box gap={1}>
                      <Text bold color="cyan">{figures.lozenge} DeepSeek Code</Text>
                      <Text dimColor>v{pkg.version}</Text>
                    </Box>
                    {item.agentName && (
                      <Text color="cyan" dimColor>[{item.agentName}]</Text>
                    )}
                    <Text dimColor>/help  {figures.bullet}  Ctrl+C{figures.cross}2 to exit</Text>
                  </Box>
                ) : (
                  // Full version for wide terminals
                  <Box gap={2} alignItems="center">
                    <DeepSeekMascot />
                    <Box flexDirection="column">
                      <Box gap={1} alignItems="center">
                        <Text bold color="cyan">{figures.lozenge} DeepSeek Code</Text>
                        <Text dimColor>v{pkg.version}</Text>
                        <Text dimColor>·</Text>
                        <Text dimColor>{item.provider}</Text>
                        {item.agentName && <>
                          <Text dimColor>·</Text>
                          <Text color="cyan" dimColor>[{item.agentName}]</Text>
                        </>}
                      </Box>
                      <Box gap={1}>
                        <Text dimColor>cwd:</Text>
                        <Text color="blueBright">{process.cwd()}</Text>
                      </Box>
                      <Text dimColor>/help for commands  ·  Ctrl+C twice to exit</Text>
                    </Box>
                  </Box>
                )}
              </Box>
            )
          }
          return <MessageItem key={item.index} message={item.message} theme={theme} agentLabel={agentLabel} />
        }}
      </Static>
      {streamText ? (
        <Box flexDirection="column" marginTop={1}>
          {streamRole === 'terminal' ? (
            <>
              <Box gap={1}>
                <Text color="magenta" bold>$</Text>
                <Text color="magenta" dimColor>terminal</Text>
              </Box>
              <Box marginLeft={2}>
                {renderLines(streamText)}
              </Box>
            </>
          ) : (
            <Box gap={1} alignItems="flex-start">
              <Text color="green" bold>{figures.circleFilled}</Text>
              <Box flexDirection="column" flexShrink={1}>
                <MarkdownRenderer content={sanitizeStreamMarkdown(streamText)} theme={theme} />
              </Box>
            </Box>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
