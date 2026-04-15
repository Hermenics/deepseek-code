import React from 'react'
import { Box, Text } from 'ink'
import type { ToolStatus } from '../App.js'

export const ToolUseDisplay = React.memo(function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
  if (tool.done) {
    return (
      <Box paddingLeft={3}>
        <Text color="green">{`✓ ${tool.name}${tool.result ? ` → ${tool.result}` : ''}`}</Text>
      </Box>
    )
  }
  return (
    <Box paddingLeft={3} gap={1}>
      <Text color="yellow">⚙</Text>
      <Text color="yellow">{tool.name}</Text>
      {tool.args ? <Text dimColor>({tool.args})</Text> : null}
    </Box>
  )
})
