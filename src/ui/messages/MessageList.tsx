import React from 'react'
import { Box, Text, Static } from 'ink'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'
import { DeepSeekMascot } from '../layout/Mascot.js'
import pkg from '../../../package.json' with { type: 'json' }

const RoleSeparator = React.memo(function RoleSeparator({ label, color }: { label: string; color: string }) {
  const cols = process.stdout.columns ?? 80
  const inner = ` ── ${label} `
  const dashes = '─'.repeat(Math.max(0, cols - inner.length - 1))
  return (
    <Box marginTop={1}>
      <Text dimColor> ── </Text>
      <Text color={color as any} bold>{label}</Text>
      <Text dimColor> {dashes}</Text>
    </Box>
  )
})

function MessageItem({ message: m, theme, agentLabel }: { message: Message; theme: ThemeName; agentLabel: string }) {
  if (m.role === 'user') {
    return (
      <Box flexDirection="column">
        <RoleSeparator label="you" color="white" />
        <Box paddingLeft={1} marginTop={0}>
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
      return (
        <Box flexDirection="column" marginTop={1} paddingLeft={3}>
          <Box gap={1}>
            <Text color={isDone ? 'cyan' : 'yellow'}>{'◆'}</Text>
            <Text color={isDone ? 'cyan' : 'yellow'} bold>subagent</Text>
            <Text dimColor>{isDone ? 'completed' : 'working...'}</Text>
          </Box>
          {label && (
            <Box marginLeft={2} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor={isDone ? 'cyan' : 'yellow'} paddingLeft={1}>
              <Text dimColor>{label.slice(0, 200)}{label.length > 200 ? '...' : ''}</Text>
            </Box>
          )}
        </Box>
      )
    }
    const isDone = m.content.startsWith('✓')
    const isRunning = m.content.startsWith('⚙')
    return (
      <Box paddingLeft={3}>
        <Text color={isDone ? 'green' : isRunning ? 'yellow' : 'gray'}>
          {m.content}
        </Text>
      </Box>
    )
  }
  // assistant
  return (
    <Box flexDirection="column">
      <RoleSeparator label={agentLabel} color="cyan" />
      <Box paddingLeft={1} marginTop={1}>
        <MarkdownRenderer content={m.content} theme={theme} />
      </Box>
    </Box>
  )
}

type StaticItem =
  | { kind: 'header'; provider: string; agentName: string | null }
  | { kind: 'message'; message: Message; index: number }

export function MessageList({ messages, streamText, theme, activeAgent, headerProvider, headerAgent }: {
  messages: Message[]
  streamText: string
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
            return (
              <Box key="header" flexDirection="row" paddingX={1} paddingTop={1} paddingBottom={0}>
                <Box marginRight={2}>
                  <DeepSeekMascot />
                </Box>
                <Box flexDirection="column" justifyContent="center">
                  <Box>
                    <Text bold color="cyan">◆ DeepSeek Code  </Text>
                    <Text dimColor>v{pkg.version}  ·  {item.provider}</Text>
                  </Box>
                  <Text bold color="blueBright">Welcome to DeepSeek Code!</Text>
                  <Text dimColor>/help for commands  ·  Ctrl+C twice to exit</Text>
                  <Text color="cyan" dimColor>{`[${item.agentName ?? 'deepseek'}] We're in `}<Text bold color="blueBright">{process.cwd()}</Text>{`, right?`}</Text>
                </Box>
              </Box>
            )
          }
          return <MessageItem key={item.index} message={item.message} theme={theme} agentLabel={agentLabel} />
        }}
      </Static>
      {streamText ? (
        <Box flexDirection="column">
          <RoleSeparator label={agentLabel} color="cyan" />
          <Box paddingLeft={1} marginTop={1}>
            <MarkdownRenderer content={streamText} theme={theme} />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
