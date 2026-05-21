import type { Cursor } from '../cursor/index.js'

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
        <text fg="white" bg="white">{' '}</text>
        <text fg="#888888">{placeholder}</text>
      </>
    )
  }

  if (value.includes('\n')) {
    const lines = value.split('\n')
    let offset = 0
    return (
      <box flexDirection="column">
        {lines.map((line, li) => {
          const lineStart = offset
          const lineEnd = offset + line.length
          offset += line.length + 1
          const cursorInLine = cursorPos >= lineStart && cursorPos <= lineEnd
          if (!cursorInLine) {
            return <text key={li}>{li > 0 ? '  ' : ''}{line || ' '}</text>
          }
          const localPos = cursorPos - lineStart
          const before = line.slice(0, localPos)
          const at = line.slice(localPos, localPos + 1) || ' '
          const after = line.slice(localPos + 1)
          return (
            <box key={li} flexDirection="row">
              {li > 0 && <text>{'  '}</text>}
              <text>{before}</text>
              <text fg="black" bg="white">{at}</text>
              <text>{after}</text>
            </box>
          )
        })}
      </box>
    )
  }

  const maxVisible = Math.max(20, columns - 10)
  if (value.length <= maxVisible) {
    const beforeCursor = value.slice(0, cursorPos)
    const atCursor = value.slice(cursorPos, cursorPos + 1) || ' '
    const afterCursor = value.slice(cursorPos + 1)
    return (
      <>
        <text>{beforeCursor}</text>
        <text fg="black" bg="white">{atCursor}</text>
        <text>{afterCursor}</text>
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
      <text fg="#888888">{prefix}</text>
      <text>{beforeCursor}</text>
      <text fg="black" bg="white">{atCursor}</text>
      <text>{afterCursor}</text>
      <text fg="#888888">{suffix}</text>
    </>
  )
}
