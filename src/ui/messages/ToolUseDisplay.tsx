import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'
import type { ToolStatus } from '../App.js'

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

export const ToolUseDisplay = React.memo(function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
  const display = TOOL_DISPLAY[tool.name] ?? tool.name
  const rawArg = tool.done ? (tool.result ?? '') : (tool.args ?? '')
  const arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (tool.done) return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [tool.done])

  return (
    <Box paddingLeft={2} gap={1}>
      <Text color="green" bold>{figures.circleFilled}</Text>
      <Text bold>{display}</Text>
      {arg ? <Text dimColor>({arg})</Text> : null}
      {!tool.done && elapsed > 0 && <Text dimColor>{elapsed}s</Text>}
    </Box>
  )
})
