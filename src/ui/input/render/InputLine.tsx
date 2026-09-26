import type { Cursor } from '../cursor/index.js'
import { wrapVisualLines } from '../cursor/MeasuredText.js'
import Box from '../../../ink/components/Box.js'
import Text from '../../../ink/components/Text.js'
import { useThemeColors } from '../../design-system/ThemeProvider.js'

interface InputLineProps {
  cursor: Cursor
  columns: number
  placeholder?: string
  ghostText?: string
  maxVisibleLines?: number
  prefix?: string
  prefixColor?: string
}

/** Width the input text wraps at inside `columns`; InputBox measures its cursor with this too, so ↑/↓ follow the drawn lines. */
export function inputWrapWidth(columns: number, prefixLen = 0): number {
  return Math.max(20, columns - 4 - prefixLen)
}

/** Renders the input text with a block cursor, word-wrapped to the terminal width and scrolled so the cursor stays inside a viewport of `maxVisibleLines` (default 10), with counts of hidden lines above/below. Empty input shows the ghost text or placeholder; otherwise ghost text trails the text (on multi-line input only when the cursor is on the last line). */
export function InputLine({
  cursor,
  columns,
  placeholder = 'What do you want me to do? ↵',
  ghostText,
  maxVisibleLines,
  prefix = '',
  prefixColor = 'cyan',
}: InputLineProps) {
  const colors = useThemeColors()
  const value = cursor.text
  const cursorPos = cursor.offset
  const prefixLen = prefix.length
  // Available width for text (leave some margin for the chrome and prefix)
  const wrapWidth = inputWrapWidth(columns, prefixLen)

  if (value === '') {
    return (
      <>
        {prefix && <Text color={prefixColor}>{prefix}</Text>}
        <Text color={colors.inputCursorText} backgroundColor={colors.inputCursorBg}>{' '}</Text>
        <Text color={ghostText ? colors.textInactive : colors.textDim}>{ghostText ?? placeholder}</Text>
      </>
    )
  }

  const maxVisible = maxVisibleLines ?? 10

  // Newlines (Shift+Enter) and word wrap, shared with cursor movement
  const visualLines = wrapVisualLines(value, wrapWidth).map(({ start, end }) => ({
    text: value.slice(start, end),
    offsetInValue: start,
  }))

  // Single line, no wrap needed — use simple rendering
  if (visualLines.length === 1 && !value.includes('\n')) {
    const beforeCursor = value.slice(0, cursorPos)
    const atCursor = value.slice(cursorPos, cursorPos + 1) || ' '
    const afterCursor = value.slice(cursorPos + 1)
    return (
      <>
        {prefix && <Text color={prefixColor}>{prefix}</Text>}
        <Text>{beforeCursor}</Text>
        <Text color={colors.inputCursorText} backgroundColor={colors.inputCursorBg}>{atCursor}</Text>
        <Text>{afterCursor}</Text>
        {ghostText && <Text color={colors.textInactive}>{ghostText}</Text>}
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
        <Text color={colors.textDim}>{`  ↑ ${hiddenAbove} more line${hiddenAbove > 1 ? 's' : ''}`}</Text>
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
            <Text color={colors.inputCursorText} backgroundColor={colors.inputCursorBg}>{at}</Text>
            <Text>{after}</Text>
            {isLastVisualLine && ghostText && <Text color="#555555">{ghostText}</Text>}
          </Box>
        )
      })}
      {hiddenBelow > 0 && (
        <Text color={colors.textDim}>{`  ↓ ${hiddenBelow} more line${hiddenBelow > 1 ? 's' : ''}`}</Text>
      )}
    </Box>
  )
}
