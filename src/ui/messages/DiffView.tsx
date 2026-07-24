import { useMemo } from 'react'
import { getThemeColors } from '../theme.js'
import { STATUS_ICONS } from '../theme.js'
import type { ThemeName } from '../theme.js'
import { DIFF_MAX_LINES } from '../../constants.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import { computeWordDiff } from './colorDiff.js'

interface DiffLine { type: 'added' | 'removed' | 'context'; text: string; lineNo: number }

interface Props {
  path: string
  added: number
  removed: number
  firstChanged: number
  lines: DiffLine[]
  theme: ThemeName
  onOpen?: () => void
  showWordDiff?: boolean
}

function stripSigil(text: string): string {
  return text.startsWith('+') || text.startsWith('-') || text.startsWith(' ')
    ? text.slice(1)
    : text
}

export function DiffView({ path, added, removed, firstChanged, lines, theme, onOpen, showWordDiff = true }: Props) {
  const colors = getThemeColors(theme)
  const cols = process.stdout.columns ?? 80
  const filename = path.split('/').pop() ?? path

  const visibleLines = useMemo(() => lines.slice(0, DIFF_MAX_LINES), [lines])

  const maxLineNo = visibleLines.reduce((max, l) => Math.max(max, l.lineNo), 0)
  const lineNoWidth = Math.max(String(maxLineNo).length, 2)
  const gutterWidth = lineNoWidth + 3
  const contentWidth = Math.max(1, cols - gutterWidth - 4)

  // Build paired index: for each removed line immediately followed by an added line
  const pairedWith = useMemo(() => {
    const pairs = new Map<number, number>()
    for (let i = 0; i < visibleLines.length - 1; i++) {
      if (visibleLines[i].type === 'removed' && visibleLines[i + 1].type === 'added') {
        pairs.set(i, i + 1)
        pairs.set(i + 1, i)
      }
    }
    return pairs
  }, [visibleLines])

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box flexDirection="row" gap={1} paddingLeft={2} onClick={onOpen}>
        <Text color={colors.success}>{STATUS_ICONS.assistant}</Text>
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
          const defaultTextColor = isAdd ? colors.diffAddedWord : isDel ? colors.diffRemovedWord : colors.textDim

          const code = stripSigil(line.text)
          const truncated = code.length > contentWidth ? code.slice(0, contentWidth - 1) + '…' : code
          const padding = ' '.repeat(Math.max(0, contentWidth - truncated.length))

          const lineNoStr = (isAdd || line.type === 'context')
            ? String(line.lineNo).padStart(lineNoWidth)
            : ' '.repeat(lineNoWidth)

          const partnerIdx = pairedWith.get(i)
          const hasPair = partnerIdx !== undefined

          // Word-level diff for paired lines — use truncated text to avoid quadratic work on long lines
          let wordSegments: ReturnType<typeof computeWordDiff> | null = null
          if (showWordDiff && hasPair && (isAdd || isDel)) {
            const removedLine = isDel ? line : visibleLines[partnerIdx!]
            const addedLine = isAdd ? line : visibleLines[partnerIdx!]
            const truncRem = stripSigil(removedLine.text).slice(0, contentWidth)
            const truncAdd = stripSigil(addedLine.text).slice(0, contentWidth)
            wordSegments = computeWordDiff(truncRem, truncAdd)
          }

          const segments = wordSegments
            ? (isDel ? wordSegments.removed : wordSegments.added)
            : null

          return (
            <Box key={i} flexDirection="row">
              {/* Gutter */}
              <Text backgroundColor={bgColor} color={colors.textSubtle} dimColor={!isAdd && !isDel}>
                {' ' + lineNoStr + ' ' + sigil + ' '}
              </Text>
              {/* Code content */}
              {segments ? (
                <Box flexDirection="row">
                  {segments.map((seg, si) => {
                    const isChanged = (isDel && seg.type === 'removed') || (isAdd && seg.type === 'added')
                    return (
                      <Text
                        key={si}
                        backgroundColor={bgColor}
                        color={isChanged ? (isDel ? colors.diffRemovedWord : colors.diffAddedWord) : defaultTextColor}
                        bold={isChanged}
                      >
                        {seg.text}
                      </Text>
                    )
                  })}
                  <Text backgroundColor={bgColor} color={defaultTextColor}>{padding}</Text>
                </Box>
              ) : (
                <Text backgroundColor={bgColor} color={defaultTextColor}>
                  {truncated + padding}
                </Text>
              )}
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
