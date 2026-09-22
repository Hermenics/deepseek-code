import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'
import path from 'path'
import { useThemeColors } from '../../design-system/ThemeProvider.js'

interface FileDropdownProps {
  files: string[]
  selectedIdx: number
  columns: number
  query: string
}

/** Renders the @-mention file completion list: up to 6 rows around the selection showing file name and truncated parent directory, or "No files found" when there are no matches. */
export function FileDropdown({ files, selectedIdx, columns, query: _query }: FileDropdownProps) {
  const colors = useThemeColors()
  const MAX_VISIBLE = 6

  const total = files.length
  const half = Math.floor(MAX_VISIBLE / 2)
  let start = Math.max(0, selectedIdx - half)
  const end = Math.min(total, start + MAX_VISIBLE)
  if (end - start < MAX_VISIBLE) start = Math.max(0, end - MAX_VISIBLE)
  const visible = files.slice(start, end)

  if (total === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={colors.rule}>{'│ '}</Text>
          <Text color={colors.textDim}>No files found</Text>
        </Box>
      </Box>
    )
  }

  const NAME_WIDTH = 28
  const dirMaxLen = Math.max(10, columns - NAME_WIDTH - 6)

  return (
    <Box flexDirection="column">
      {visible.map((filePath, vi) => {
        const i = start + vi
        const isSelected = i === selectedIdx
        const fileName = path.basename(filePath)
        const dirName = path.dirname(filePath) === '.' ? '' : path.dirname(filePath)
        const truncDir = dirName.length > dirMaxLen ? '…' + dirName.slice(-(dirMaxLen - 1)) : dirName

        return (
          <Box key={filePath} flexDirection="row">
            <Text color={colors.rule}>{'│ '}</Text>
            <Text color={isSelected ? colors.primary : undefined} bold={isSelected}>
              {fileName.padEnd(NAME_WIDTH)}
            </Text>
            <Text color={isSelected ? colors.h2 : colors.textSubtle}>
              {truncDir}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
