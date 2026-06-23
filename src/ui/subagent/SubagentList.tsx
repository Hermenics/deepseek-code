import React from 'react'
import Box from '../../ink/components/Box.js'
import { SubagentLine } from './SubagentLine.js'
import type { SubagentListProps } from './types.js'

export function SubagentList({ agents, theme = 'dark' }: SubagentListProps): React.ReactElement | null {
  if (agents.length === 0) return null

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {agents.map((agent, i) => (
        <Box key={agent.id}>
          <SubagentLine
            agent={agent}
            isLast={i === agents.length - 1}
            theme={theme}
          />
        </Box>
      ))}
    </Box>
  )
}
