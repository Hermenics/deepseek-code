import React from 'react'
import { Text } from 'ink'
import type { ToolStatus } from '../App.js'

export function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
  if (tool.done) {
    return <Text color="green">{`✓ ${tool.name} → ${tool.result || 'done'}`}</Text>
  }
  return <Text color="yellow">{`⚙ Running: ${tool.name}(${tool.args})`}</Text>
}
