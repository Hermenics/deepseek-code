import type { Cursor } from '../cursor/index.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'

interface InputLineProps {
  cursor: Cursor
  columns: number
  placeholder?: string
}

export function InputLine({ cursor, columns, placeholder = 'What do you want me to do? ↵' }: InputLineProps) {
  const value = cursor.text
  const cursorPos = cursor.offset

  if (value === '') {
    return (
      <>
        <Text color="white" backgroundColor="white">{' '}</Text>
        <Text color="#888888">{placeholder}</Text>
      </>
    )
  }

  if (value.includes('\n')) {
    const lines = value.split('\n')
    let offset = 0
    return (
      <Box flexDirection="column">
        {lines.map((line, li) => {
          const lineStart = offset
          const lineEnd = offset + line.length
          offset += line.length + 1
          const cursorInLine = cursorPos >= lineStart && cursorPos <= lineEnd
          if (!cursorInLine) {
            return <Text key={li}>{li > 0 ? '  ' : ''}{line || ' '}</Text>
          }
          const localPos = cursorPos - lineStart
          const before = line.slice(0, localPos)
          const at = line.slice(localPos, localPos + 1) || ' '
          const after = line.slice(localPos + 1)
          return (
            <Box key={li} flexDirection="row">
              {li > 0 && <Text>{'  '}</Text>}
              <Text>{before}</Text>
              <Text color="black" backgroundColor="white">{at}</Text>
              <Text>{after}</Text>
            </Box>
          )
        })}
      </Box>
    )
  }

  const maxVisible = Math.max(20, columns - 10)
  if (value.length <= maxVisible) {
    const beforeCursor = value.slice(0, cursorPos)
    const atCursor = value.slice(cursorPos, cursorPos + 1) || ' '
    const afterCursor = value.slice(cursorPos + 1)
    return (
      <>
        <Text>{beforeCursor}</Text>
        <Text color="black" backgroundColor="white">{atCursor}</Text>
        <Text>{afterCursor}</Text>
      </>
    )
  }

  const half = Math.floor((maxVisible - 2) / 2)
  let start = Math.max(0, cursorPos - half)
  let end = Math.min(value.length, start + maxVisible - 2)
  if (end === value.length) start = Math.max(0, end - maxVisible + 2)
  if (start === 0) end = Math.min(value.length, maxVisible - 2)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < value.length ? '…' : ''
  const visible = value.slice(start, end)
  const localCursor = cursorPos - start
  const beforeCursor = visible.slice(0, localCursor)
  const atCursor = visible.slice(localCursor, localCursor + 1) || ' '
  const afterCursor = visible.slice(localCursor + 1)

  return (
    <>
      <Text color="#888888">{prefix}</Text>
      <Text>{beforeCursor}</Text>
      <Text color="black" backgroundColor="white">{atCursor}</Text>
      <Text>{afterCursor}</Text>
      <Text color="#888888">{suffix}</Text>
    </>
  )
}
