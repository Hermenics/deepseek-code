import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'

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

export function MessageList({ messages, streamText, theme, activeAgent }: {
  messages: Message[]
  streamText: string
  theme: ThemeName
  activeAgent?: string | null
}) {
  const agentLabel = activeAgent ?? 'deepseek'

  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <Box key={i} flexDirection="column">
              <RoleSeparator label="você" color="white" />
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
                return <DiffView key={i} path={json.path} added={json.added} removed={json.removed} firstChanged={json.firstChanged} lines={json.lines} theme={theme} />
              }
            } catch { /* not JSON */ }
          }
          // Subagent special rendering
          if (m.content.startsWith('✓ subagent →') || m.content.startsWith('⚙ subagent')) {
            const isDone = m.content.startsWith('✓')
            const label = isDone ? m.content.slice('✓ subagent → '.length) : m.content.slice('⚙ subagent('.length, -1)
            return (
              <Box key={i} flexDirection="column" marginTop={1} paddingLeft={3}>
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
            <Box key={i} paddingLeft={3}>
              <Text color={isDone ? 'green' : isRunning ? 'yellow' : 'gray'}>
                {m.content}
              </Text>
            </Box>
          )
        }
        // assistant
        return (
          <Box key={i} flexDirection="column">
            <RoleSeparator label={agentLabel} color="cyan" />
            <Box paddingLeft={1} marginTop={1}>
              <MarkdownRenderer content={m.content} theme={theme} />
            </Box>
          </Box>
        )
      })}
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