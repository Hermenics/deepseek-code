import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from './App.js'
import { DiffView } from './DiffView.js'
import type { ThemeName } from './ApiKeySetup.js'

export function MessageList({ messages, streamText, theme }: { messages: Message[]; streamText: string; theme: ThemeName }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return <Text key={i} color="cyan">{`> ${m.content}`}</Text>
        }
        if (m.role === 'tool') {
          // Check if it's a diff result from write_file
          if (m.content.startsWith('✓ write_file →')) {
            try {
              const json = JSON.parse(m.content.slice('✓ write_file → '.length))
              if (json.__diff) {
                return <DiffView key={i} path={json.path} added={json.added} removed={json.removed} lines={json.lines} theme={theme} />
              }
            } catch { /* not JSON, render normally */ }
          }
          const isDone = m.content.startsWith('✓')
          const isRunning = m.content.startsWith('⚙')
          return (
            <Text key={i} color={isDone ? 'green' : isRunning ? 'yellow' : undefined} dimColor={!isDone && !isRunning}>
              {m.content}
            </Text>
          )
        }
        return <Text key={i}>{m.content}</Text>
      })}
      {streamText ? <Text>{streamText}</Text> : null}
    </Box>
  )
}
