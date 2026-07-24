import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'
import path from 'path'

interface FileDropdownProps {
  files: string[]
  selectedIdx: number
  columns: number
  query: string
}

export function FileDropdown({ files, selectedIdx, columns, query: _query }: FileDropdownProps) {
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
          <Text color="#888888">{'│ '}</Text>
          <Text color="#888888">No files found</Text>
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
            <Text color="#888888">{'│ '}</Text>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {fileName.padEnd(NAME_WIDTH)}
            </Text>
            <Text color={isSelected ? '#88cccc' : '#666666'}>
              {truncDir}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
