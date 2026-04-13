import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from './App.js'

export function MessageList({ messages, streamText }: { messages: Message[]; streamText: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return <Text key={i} color="cyan">{`> ${m.content}`}</Text>
        }
        if (m.role === 'tool') {
          return <Text key={i} dimColor>{m.content}</Text>
        }
        return <Text key={i}>{m.content}</Text>
      })}
      {streamText ? <Text>{streamText}</Text> : null}
    </Box>
  )
}
