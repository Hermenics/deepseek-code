import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '../App.js'
import { DiffView } from './DiffView.js'
import { MarkdownRenderer } from './MarkdownRenderer.js'
import type { ThemeName } from '../setup/ApiKeySetup.js'

export function MessageList({ messages, streamText, theme }: { messages: Message[]; streamText: string; theme: ThemeName }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <Box key={i} flexDirection="column" marginTop={1}>
              <Text dimColor>{'─'.repeat(60)}</Text>
              <Text>{m.content}</Text>
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
              <Box key={i} flexDirection="column" marginTop={1}>
                <Box gap={1}>
                  <Text color={isDone ? 'green' : 'yellow'}>{'◆'}</Text>
                  <Text color={isDone ? 'green' : 'yellow'} bold>Subagent</Text>
                  {isDone && <Text dimColor>completed</Text>}
                  {!isDone && <Text dimColor>working...</Text>}
                </Box>
                {label && (
                  <Box marginLeft={2} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor={isDone ? 'green' : 'yellow'} paddingLeft={1}>
                    <Text dimColor>{label.slice(0, 200)}{label.length > 200 ? '...' : ''}</Text>
                  </Box>
                )}
              </Box>
            )
          }
          const isDone = m.content.startsWith('✓')
          const isRunning = m.content.startsWith('⚙')
          return (
            <Box key={i} gap={1}>
              <Text color={isDone ? 'green' : isRunning ? 'yellow' : 'gray'}>{'●'}</Text>
              <Text color={isDone ? 'green' : isRunning ? 'yellow' : undefined} dimColor={!isDone && !isRunning}>
                {m.content}
              </Text>
            </Box>
          )
        }
        // assistant
        return (
          <Box key={i} gap={1} marginTop={1}>
            <Box borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor="cyan" paddingLeft={1}>
              <MarkdownRenderer content={m.content} theme={theme} />
            </Box>
          </Box>
        )
      })}
      {streamText ? (
        <Box gap={1} marginTop={1}>
          <Box borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor="cyan" paddingLeft={1}>
            <MarkdownRenderer content={streamText} theme={theme} />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}