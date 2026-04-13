import React from 'react'
import { Box, Text } from 'ink'
import type { Model } from '../commands.js'

export function StatusBar({ tokenCount, model, activeAgent }: { tokenCount: number; model: Model; activeAgent: string | null }) {
  return (
    <Box marginTop={1} gap={1}>
      <Text dimColor>DeepSeek Code</Text>
      <Text dimColor>|</Text>
      <Text dimColor>{model}</Text>
      {activeAgent && (
        <>
          <Text dimColor>|</Text>
          <Text color="cyan">agent: {activeAgent}</Text>
        </>
      )}
      <Text dimColor>|</Text>
      <Text dimColor>{tokenCount} tokens</Text>
    </Box>
  )
}
