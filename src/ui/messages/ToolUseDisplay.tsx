import React from 'react'
import { Box, Text } from 'ink'
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

const TOOL_ICONS: Record<string, string> = {
  read_file:        '○',
  write_file:       '●',
  patch_file:       '◐',
  read_folder:      '▤',
  shell:            '▶',
  grep:             '⊕',
  glob:             '◇',
  web_fetch:        '◉',
  subagent:         '◈',
  git:              '⎇',
  introspect:       '◆',
  update_knowledge: '◑',
  todo:             '▣',
}

const TOOL_COLORS: Record<string, string> = {
  read_file:        'blue',
  write_file:       'green',
  patch_file:       'yellow',
  read_folder:      'cyan',
  shell:            'magenta',
  grep:             'cyan',
  glob:             'blue',
  web_fetch:        'green',
  subagent:         'yellow',
  git:              'magenta',
  introspect:       'cyan',
  update_knowledge: 'green',
  todo:             'yellow',
}

export const ToolUseDisplay = React.memo(function ToolUseDisplay({ tool }: { tool: ToolStatus }) {
  const display = TOOL_DISPLAY[tool.name] ?? tool.name
  const icon = TOOL_ICONS[tool.name] ?? '◦'
  const iconColor = tool.done ? 'green' : (TOOL_COLORS[tool.name] ?? 'yellow')
  const rawArg = tool.done ? (tool.result ?? '') : (tool.args ?? '')
  const arg = rawArg.length > 60 ? rawArg.slice(0, 60) + '…' : rawArg

  return (
    <Box paddingLeft={2} gap={1}>
      <Text color={tool.done ? 'green' : 'yellow'}>⎿</Text>
      <Text color={iconColor}>{icon}</Text>
      <Text color={tool.done ? 'white' : 'yellow'} bold={!tool.done}>{display}</Text>
      {arg ? <Text dimColor>{arg}</Text> : null}
    </Box>
  )
})
