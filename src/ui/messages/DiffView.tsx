import { useMemo } from 'react'
import { getThemeColors, STATUS_ICONS, DIVIDER_CHAR } from '../theme.js'
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
  const filename = path.split('/').pop() ?? path

  const diffText = useMemo(() => {
    const visible = lines.slice(0, DIFF_MAX_LINES)
    return visible.map((l) => l.text).join('\n')
  }, [lines])

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header with file path */}
      <Box flexDirection="row" gap={1} paddingLeft={2}>
        <Text color={colors.success}>{STATUS_ICONS.success}</Text>
        <Text color={colors.textDim}>{'Write'}</Text>
        <Text color={colors.primary}>{path}</Text>
      </Box>

      {/* Stats line */}
      <Box paddingLeft={4} marginTop={0}>
        <Text color={colors.diffAddedWord}>{'+' + added}</Text>
        <Text color={colors.textDim}>{' / '}</Text>
        <Text color={colors.diffRemovedWord}>{'-' + removed}</Text>
        <Text color={colors.textDim}>{' at L' + firstChanged + ' in ' + filename}</Text>
      </Box>

      {/* Diff content */}
      <Box flexDirection="column" paddingLeft={4} marginTop={1}>
        {diffText.split('\n').map((line, i) => {
          const isAdd = line.startsWith('+')
          const isDel = line.startsWith('-')
          return (
            <Text
              key={i}
              backgroundColor={isAdd ? colors.diffAdded : isDel ? colors.diffRemoved : undefined}
              color={isAdd ? colors.diffAddedWord : isDel ? colors.diffRemovedWord : colors.textDim}
            >
              {line}
            </Text>
          )
        })}
      </Box>
    </Box>
  )
}
