import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'
import codeExcerpt from 'code-excerpt'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'
import cliBoxes from 'cli-boxes'
import type { ThemeName } from '../setup/ApiKeySetup.js'

const DIFF_COLORS: Record<ThemeName, { added: string; removed: string; addedText: string; removedText: string }> = {
  'dark':             { added: 'rgb(34,92,43)',    removed: 'rgb(122,41,54)',   addedText: 'rgb(56,166,96)',  removedText: 'rgb(179,89,107)' },
  'light':            { added: 'rgb(105,219,124)', removed: 'rgb(255,168,180)', addedText: 'rgb(47,157,68)', removedText: 'rgb(209,69,75)'  },
  'dark-daltonized':  { added: 'rgb(0,68,102)',    removed: 'rgb(102,0,0)',     addedText: 'rgb(0,119,179)', removedText: 'rgb(179,0,0)'    },
  'light-daltonized': { added: 'rgb(153,204,255)', removed: 'rgb(255,204,204)', addedText: 'rgb(51,102,204)',removedText: 'rgb(153,51,51)'  },
  'dark-ansi':        { added: 'green',            removed: 'red',              addedText: 'greenBright',    removedText: 'redBright'       },
  'light-ansi':       { added: 'green',            removed: 'red',              addedText: 'greenBright',    removedText: 'redBright'       },
}

// Prefix symbols for diff lines
const DIFF_PREFIX = {
  added:   `${figures.tick} `,
  removed: `${figures.cross} `,
  context: '  ',
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
const CONTEXT_AROUND = 3

export const DiffView = React.memo(function DiffView({ path, added, removed, firstChanged, lines, theme }: Props) {
  const c = DIFF_COLORS[theme]
  const filename = path.split('/').pop() ?? path

  const visible = useMemo(() => {
    // Use code-excerpt to extract context around each change cluster
    const changeIndices = lines
      .map((l, i) => l.type !== 'context' ? i : -1)
      .filter((i) => i >= 0)

    if (changeIndices.length === 0) return lines.slice(0, MAX_LINES)

    // Build source string from diff lines for code-excerpt
    const source = lines.map((l) => l.text).join('\n')

    // Collect visible line indices using code-excerpt around each change
    const visibleSet = new Set<number>()
    for (const idx of changeIndices) {
      // code-excerpt uses 1-based line numbers
      const excerpted = codeExcerpt(source, idx + 1, { around: CONTEXT_AROUND })
      if (!excerpted) continue
      for (const entry of excerpted) {
        // Convert back to 0-based index
        visibleSet.add(entry.line - 1)
      }
    }

    // Build visible lines preserving order, inserting separator markers for gaps
    const sortedIndices = [...visibleSet].sort((a, b) => a - b)
    const result: (DiffLine | { type: 'separator' })[] = []
    let prevIdx = -1
    for (const idx of sortedIndices) {
      if (prevIdx >= 0 && idx - prevIdx > 1) {
        result.push({ type: 'separator' })
      }
      if (lines[idx]) result.push(lines[idx]!)
      prevIdx = idx
    }

    return result.slice(0, MAX_LINES)
  }, [lines])

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box gap={1}>
        <Text color="green">{figures.circleFilled}</Text>
        <Text>Write <Text color="cyan">{path}</Text></Text>
      </Box>
      {/* Subtitle with figures */}
      <Box marginLeft={2}>
        <Text color={c.addedText}>{figures.tick} {added} {added === 1 ? 'line' : 'lines'}</Text>
        <Text dimColor>  </Text>
        <Text color={c.removedText}>{figures.cross} {removed} {removed === 1 ? 'line' : 'lines'}</Text>
        <Text dimColor> at L{firstChanged} in {filename}</Text>
      </Box>
      {/* Diff lines with prefix symbols and code-excerpt context */}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {visible.map((line, i) => {
          if (line.type === 'separator') {
            return <Text key={i} dimColor>  {figures.ellipsis}</Text>
          }
          const dl = line as DiffLine
          return (
            <Box key={i} gap={0}>
              <Text dimColor>{String(dl.lineNo).padStart(4)} </Text>
              <Text
                color={dl.type === 'added' ? c.addedText : dl.type === 'removed' ? c.removedText : undefined}
                dimColor={dl.type === 'context'}
              >
                {DIFF_PREFIX[dl.type]}
              </Text>
              <Text
                backgroundColor={dl.type === 'added' ? c.added : dl.type === 'removed' ? c.removed : undefined}
                color={dl.type === 'added' ? c.addedText : dl.type === 'removed' ? c.removedText : undefined}
                dimColor={dl.type === 'context'}
              >
                {dl.text}
              </Text>
            </Box>
          )
        })}
        {lines.length > MAX_LINES && <Text dimColor>{cliBoxes.round.top.repeat(3)} +{lines.length - MAX_LINES} lines (ctrl+o to toggle)</Text>}
      </Box>
    </Box>
  )
})
