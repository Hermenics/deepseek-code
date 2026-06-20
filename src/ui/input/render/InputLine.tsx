import type { Cursor } from '../cursor/index.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'

interface InputLineProps {
  cursor: Cursor
  columns: number
  placeholder?: string
  ghostText?: string
  maxVisibleLines?: number
  prefix?: string
  prefixColor?: string
}

/**
 * Wraps a single line of text into multiple visual lines based on column width.
 * Returns an array of { text, startOffset } for each wrapped segment.
 */
function wrapLine(line: string, maxWidth: number): { text: string; startOffset: number }[] {
  if (maxWidth <= 0) maxWidth = 80
  if (line.length <= maxWidth) {
    return [{ text: line, startOffset: 0 }]
  }
  const segments: { text: string; startOffset: number }[] = []
  let pos = 0
  while (pos < line.length) {
    const chunk = line.slice(pos, pos + maxWidth)
    segments.push({ text: chunk, startOffset: pos })
    pos += chunk.length
  }
  return segments
}

export function InputLine({
  cursor,
  columns,
  placeholder = 'What do you want me to do? ↵',
  ghostText,
  maxVisibleLines,
  prefix = '',
  prefixColor = 'cyan',
}: InputLineProps) {
  const value = cursor.text
  const cursorPos = cursor.offset
  const prefixLen = prefix.length
  // Available width for text (leave some margin for the chrome and prefix)
  const wrapWidth = Math.max(20, columns - 4 - prefixLen)

  if (value === '') {
    return (
      <>
        {prefix && <Text color={prefixColor}>{prefix}</Text>}
        <Text color="white" backgroundColor="white">{' '}</Text>
        <Text color="#888888">{placeholder}</Text>
      </>
    )
  }

  // Split by hard newlines (Shift+Enter)
  const hardLines = value.split('\n')
  const maxVisible = maxVisibleLines ?? 10

  // Build visual lines with word wrap
  type VisualLine = {
    text: string
    hardLineIdx: number
    offsetInValue: number // absolute offset in value where this visual line starts
  }
  const visualLines: VisualLine[] = []
  let absoluteOffset = 0

  for (let i = 0; i < hardLines.length; i++) {
    const line = hardLines[i]!
    const wrapped = wrapLine(line, wrapWidth)
    for (const seg of wrapped) {
      visualLines.push({
        text: seg.text,
        hardLineIdx: i,
        offsetInValue: absoluteOffset + seg.startOffset,
      })
    }
    absoluteOffset += line.length + 1 // +1 for the \n
  }

  // Single line, no wrap needed — use simple rendering
  if (visualLines.length === 1 && !value.includes('\n')) {
    const beforeCursor = value.slice(0, cursorPos)
    const atCursor = value.slice(cursorPos, cursorPos + 1) || ' '
    const afterCursor = value.slice(cursorPos + 1)
    return (
      <>
        {prefix && <Text color={prefixColor}>{prefix}</Text>}
        <Text>{beforeCursor}</Text>
        <Text color="black" backgroundColor="white">{atCursor}</Text>
        <Text>{afterCursor}</Text>
        {ghostText && <Text color="#555555">{ghostText}</Text>}
      </>
    )
  }

  // Find which visual line the cursor is on
  let cursorVisualLineIdx = visualLines.length - 1
  for (let i = 0; i < visualLines.length; i++) {
    const vl = visualLines[i]!
    const nextStart = i + 1 < visualLines.length ? visualLines[i + 1]!.offsetInValue : value.length + 1
    if (cursorPos >= vl.offsetInValue && cursorPos < nextStart) {
      cursorVisualLineIdx = i
      break
    }
  }

  // Viewport scrolling
  const half = Math.floor(maxVisible / 2)
  const viewStart = Math.max(0, Math.min(cursorVisualLineIdx - half, visualLines.length - maxVisible))
  const viewEnd = Math.min(visualLines.length, viewStart + maxVisible)
  const hiddenAbove = viewStart
  const hiddenBelow = visualLines.length - viewEnd

  const visibleLines = visualLines.slice(viewStart, viewEnd)

  return (
    <Box flexDirection="column">
      {hiddenAbove > 0 && (
        <Text color="#888888">{`  ↑ ${hiddenAbove} more line${hiddenAbove > 1 ? 's' : ''}`}</Text>
      )}
      {visibleLines.map((vl, vi) => {
        const globalVi = viewStart + vi
        const lineEnd = vl.offsetInValue + vl.text.length
        const cursorInLine = cursorPos >= vl.offsetInValue && cursorPos <= lineEnd

        const linePrefix = globalVi === 0 ? prefix : ' '.repeat(prefixLen)
        const linePrefixColor = globalVi === 0 && prefix ? prefixColor : undefined

        if (!cursorInLine) {
          return (
            <Box key={globalVi} flexDirection="row">
              {linePrefix && <Text color={linePrefixColor}>{linePrefix}</Text>}
              <Text>{vl.text || ' '}</Text>
            </Box>
          )
        }

        const localPos = cursorPos - vl.offsetInValue
        const before = vl.text.slice(0, localPos)
        const at = vl.text.slice(localPos, localPos + 1) || ' '
        const after = vl.text.slice(localPos + 1)
        const isLastVisualLine = globalVi === visualLines.length - 1

        return (
          <Box key={globalVi} flexDirection="row">
            {linePrefix && <Text color={linePrefixColor}>{linePrefix}</Text>}
            <Text>{before}</Text>
            <Text color="black" backgroundColor="white">{at}</Text>
            <Text>{after}</Text>
            {isLastVisualLine && ghostText && <Text color="#555555">{ghostText}</Text>}
          </Box>
        )
      })}
      {hiddenBelow > 0 && (
        <Text color="#888888">{`  ↓ ${hiddenBelow} more line${hiddenBelow > 1 ? 's' : ''}`}</Text>
      )}
    </Box>
  )
}
