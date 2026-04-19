import React from 'react'
import { Box, Text, Static } from 'ink'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'
import { DeepSeekMascot } from '../layout/Mascot.js'
import pkg from '../../../package.json' with { type: 'json' }


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

const TOOL_ICONS: Record<string, string> = {
  read_file:        '○',
  write_file:       '●',
  patch_file:       '◐',
  read_folder:      '▤',
  shell:            '▶',
  grep:             '⊕',
  glob:             '◇',
  web_fetch:        '◉',
  subagent:         '◈',
  git:              '⎇',
  introspect:       '◆',
  update_knowledge: '◑',
  todo:             '▣',
}

const TOOL_COLORS: Record<string, string> = {
  read_file:        'blue',
  write_file:       'green',
  patch_file:       'yellow',
  read_folder:      'cyan',
  shell:            'magenta',
  grep:             'cyan',
  glob:             'blue',
  web_fetch:        'green',
  subagent:         'yellow',
  git:              'magenta',
  introspect:       'cyan',
  update_knowledge: 'green',
  todo:             'yellow',
}

function formatToolLine(rawName: string, detail: string): { display: string; arg: string; icon: string; iconColor: string } {
  const display = TOOL_DISPLAY[rawName] ?? rawName
  const arg = detail.length > 60 ? detail.slice(0, 60) + '…' : detail
  const icon = TOOL_ICONS[rawName] ?? '◦'
  const iconColor = TOOL_COLORS[rawName] ?? 'yellow'
  return { display, arg, icon, iconColor }
}

function MessageItem({ message: m, theme, agentLabel }: { message: Message; theme: ThemeName; agentLabel: string }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Text color="cyan" bold>❯</Text>
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
    const isDone = m.content.startsWith('✓')
    const raw = m.content.slice(2) // strip "✓ " or "⚙ "
    const sep = raw.indexOf(' → ')
    const toolName = sep >= 0 ? raw.slice(0, sep) : raw
    const detail = sep >= 0 ? raw.slice(sep + 3) : ''
    const { display, arg, icon, iconColor } = formatToolLine(toolName, detail)
    return (
      <Box paddingLeft={2} gap={1}>
        <Text color={isDone ? 'green' : 'yellow'}>⎿ </Text>
        <Text color={isDone ? 'green' : iconColor}>{icon}</Text>
        <Text color={isDone ? 'white' : 'yellow'} dimColor={isDone}>{display}</Text>
        {arg ? <Text dimColor>{arg}</Text> : null}
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
          <Text wrap="wrap">{m.content}</Text>
        </Box>
      </Box>
    )
  }
  // assistant
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1} alignItems="flex-start">
        <Text color="green" bold>●</Text>
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
                      <Text bold color="cyan">◆ DeepSeek Code</Text>
                      <Text dimColor>v{pkg.version}</Text>
                    </Box>
                    {item.agentName && (
                      <Text color="cyan" dimColor>[{item.agentName}]</Text>
                    )}
                    <Text dimColor>/help  ·  Ctrl+C×2 to exit</Text>
                  </Box>
                ) : (
                  // Full version for wide terminals
                  <Box gap={2} alignItems="center">
                    <DeepSeekMascot />
                    <Box flexDirection="column">
                      <Box gap={1} alignItems="center">
                        <Text bold color="cyan">◆ DeepSeek Code</Text>
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
                <Text wrap="wrap">{streamText}</Text>
              </Box>
            </>
          ) : (
            <Box gap={1} alignItems="flex-start">
              <Text color="green" bold>●</Text>
              <Box flexDirection="column" flexShrink={1}>
                <Text wrap="wrap">{streamText}</Text>
              </Box>
            </Box>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
