import React from 'react'
import { Box, Text } from 'ink'
import type { ThemeName } from './ApiKeySetup.js'

const DIFF_COLORS: Record<ThemeName, { added: string; removed: string; addedText: string; removedText: string }> = {
  'dark':             { added: 'rgb(34,92,43)',    removed: 'rgb(122,41,54)',   addedText: 'rgb(56,166,96)',  removedText: 'rgb(179,89,107)' },
  'light':            { added: 'rgb(105,219,124)', removed: 'rgb(255,168,180)', addedText: 'rgb(47,157,68)', removedText: 'rgb(209,69,75)'  },
  'dark-daltonized':  { added: 'rgb(0,68,102)',    removed: 'rgb(102,0,0)',     addedText: 'rgb(0,119,179)', removedText: 'rgb(179,0,0)'    },
  'light-daltonized': { added: 'rgb(153,204,255)', removed: 'rgb(255,204,204)', addedText: 'rgb(51,102,204)',removedText: 'rgb(153,51,51)'  },
  'dark-ansi':        { added: 'green',            removed: 'red',              addedText: 'greenBright',    removedText: 'redBright'       },
  'light-ansi':       { added: 'green',            removed: 'red',              addedText: 'greenBright',    removedText: 'redBright'       },
}

interface DiffLine { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

interface Props {
  path: string
  added: number
  removed: number
  firstChanged: number
  lines: DiffLine[]
  theme: ThemeName
}

const MAX_LINES = 50

export function DiffView({ path, added, removed, firstChanged, lines, theme }: Props) {
  const c = DIFF_COLORS[theme]
  const filename = path.split('/').pop() ?? path

  const visible = lines.filter((l, i) => {
    const hasNearbyChange = lines.slice(Math.max(0, i - 2), i + 3).some((l) => l.type !== 'context')
    return hasNearbyChange
  }).slice(0, MAX_LINES)

  return (
    <Box flexDirection="column">
      {/* Header: "Write path/file.ts" */}
      <Box gap={1}>
        <Text color="green">●</Text>
        <Text>Write <Text color="cyan">{path}</Text></Text>
      </Box>
      {/* Subtitle: "added X lines, removed Y lines at LN in file.ts" */}
      <Box marginLeft={2}>
        <Text color={c.addedText}>added {added} {added === 1 ? 'line' : 'lines'}</Text>
        <Text dimColor>, </Text>
        <Text color={c.removedText}>removed {removed} {removed === 1 ? 'line' : 'lines'}</Text>
        <Text dimColor> at L{firstChanged} in {filename}</Text>
      </Box>
      {/* Diff lines */}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {visible.map((line, i) => (
          <Box key={i} gap={1}>
            <Text dimColor>{String(line.lineNo).padStart(3)}</Text>
            <Text
              backgroundColor={line.type === 'added' ? c.added : line.type === 'removed' ? c.removed : undefined}
              color={line.type === 'added' ? c.addedText : line.type === 'removed' ? c.removedText : undefined}
              dimColor={line.type === 'context'}
            >
              {line.text}
            </Text>
          </Box>
        ))}
        {lines.length > MAX_LINES && <Text dimColor>...+{lines.length - MAX_LINES} lines (ctrl+o to toggle)</Text>}
      </Box>
    </Box>
  )
}
