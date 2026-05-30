import { useMemo } from 'react'
import { getThemeColors } from '../theme.js'
import type { ThemeName } from '../theme.js'
import { DIFF_MAX_LINES } from '../../constants.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'

interface DiffLine { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

interface Props {
  path: string
  added: number
  removed: number
  firstChanged: number
  lines: DiffLine[]
  theme: ThemeName
}

export function DiffView({ path, added, removed, firstChanged, lines, theme }: Props) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80
  const filename = path.split('/').pop() ?? path

  const visibleLines = useMemo(() => lines.slice(0, DIFF_MAX_LINES), [lines])

  // Calculate max line number width for alignment
  const maxLineNo = visibleLines.reduce((max, l) => Math.max(max, l.lineNo), 0)
  const lineNoWidth = Math.max(String(maxLineNo).length, 2)

  // Available width for code content (lineNo + space + sigil + space)
  const gutterWidth = lineNoWidth + 3
  const contentWidth = Math.max(1, cols - gutterWidth - 4)

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box flexDirection="row" gap={1} paddingLeft={2}>
        <Text color={colors.success}>{'✓'}</Text>
        <Text color={colors.textDim}>{'Write'}</Text>
        <Text color="cyan">{path}</Text>
      </Box>

      {/* Stats */}
      <Box paddingLeft={4}>
        <Text color={colors.diffAddedWord}>{'+' + added}</Text>
        <Text color={colors.textDim}>{' / '}</Text>
        <Text color={colors.diffRemovedWord}>{'-' + removed}</Text>
        <Text color={colors.textDim}>{' at L' + firstChanged + ' in ' + filename}</Text>
      </Box>

      {/* Diff lines */}
      <Box flexDirection="column" marginTop={1}>
        {visibleLines.map((line, i) => {
          const isAdd = line.type === 'added'
          const isDel = line.type === 'removed'
          const sigil = isAdd ? '+' : isDel ? '-' : ' '
          const bgColor = isAdd ? colors.diffAdded : isDel ? colors.diffRemoved : undefined
          const textColor = isAdd ? colors.diffAddedWord : isDel ? colors.diffRemovedWord : colors.textDim

          // Strip leading +/- from text (already in sigil)
          const code = line.text.startsWith('+') || line.text.startsWith('-') || line.text.startsWith(' ')
            ? line.text.slice(1)
            : line.text

          // Truncate to fit terminal width
          const truncated = code.length > contentWidth ? code.slice(0, contentWidth - 1) + '…' : code
          const padding = ' '.repeat(Math.max(0, contentWidth - truncated.length))

          const lineNoStr = (isAdd || line.type === 'context')
            ? String(line.lineNo).padStart(lineNoWidth)
            : ' '.repeat(lineNoWidth)

          return (
            <Box key={i} flexDirection="row">
              {/* Gutter: line number + sigil */}
              <Text backgroundColor={bgColor} color={colors.textSubtle} dimColor={!isAdd && !isDel}>
                {' ' + lineNoStr + ' ' + sigil + ' '}
              </Text>
              {/* Code content */}
              <Text backgroundColor={bgColor} color={textColor}>
                {truncated + padding}
              </Text>
            </Box>
          )
        })}
        {lines.length > DIFF_MAX_LINES && (
          <Box paddingLeft={2}>
            <Text color={colors.textDim}>{'… ' + (lines.length - DIFF_MAX_LINES) + ' more lines'}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
