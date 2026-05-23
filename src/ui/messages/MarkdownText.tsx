/**
 * Markdown renderer using native Ink Text components for inline formatting.
 * Uses <Text bold>, <Text italic>, <Text color={...}> instead of HTML elements.
 */

import { Fragment } from 'react'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { Color } from '../../ink/styles.js'

const CODE_FG: Color = '#c3e88d'
const H1_FG: Color = '#82aaff'
const H2_FG: Color = '#89ddff'
const H3_FG: Color = '#c792ea'
const BULLET_FG: Color = '#00cccc'
const DIM_FG: Color = '#888888'
const RULE_FG: Color = '#444444'
const THINKING_FG: Color = '#666666'

function parseInline(line: string, key: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let i = 0
  let buf = ''
  let partIdx = 0

  const flush = () => {
    if (buf) {
      parts.push(buf)
      buf = ''
    }
  }

  while (i < line.length) {
    // Bold+italic: **__text__**
    if (line.startsWith('**__', i)) {
      const end = line.indexOf('__**', i + 4)
      if (end !== -1) {
        flush()
        parts.push(
          <Text key={`${key}-bi-${partIdx++}`} bold italic>
            {line.slice(i + 4, end)}
          </Text>
        )
        i = end + 4
        continue
      }
    }
    // Bold: **text**
    if (line.startsWith('**', i)) {
      const end = line.indexOf('**', i + 2)
      if (end !== -1) {
        flush()
        parts.push(
          <Text key={`${key}-b-${partIdx++}`} bold>
            {line.slice(i + 2, end)}
          </Text>
        )
        i = end + 2
        continue
      }
    }
    // Italic: __text__
    if (line.startsWith('__', i)) {
      const end = line.indexOf('__', i + 2)
      if (end !== -1) {
        flush()
        parts.push(
          <Text key={`${key}-i-${partIdx++}`} italic>
            {line.slice(i + 2, end)}
          </Text>
        )
        i = end + 2
        continue
      }
    }
    // Inline code: `text`
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        parts.push(
          <Text key={`${key}-c-${partIdx++}`} color={CODE_FG}>
            {line.slice(i + 1, end)}
          </Text>
        )
        i = end + 1
        continue
      }
    }
    buf += line[i]
    i++
  }
  flush()

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return <>{parts}</>
}

function formatLine(line: string, lineIdx: number, dimmed?: boolean): React.ReactNode {
  const k = `line-${lineIdx}`

  // Heading
  const hMatch = line.match(/^(#{1,6})\s+(.*)$/)
  if (hMatch) {
    const level = hMatch[1]!.length
    const fg: Color = level === 1 ? H1_FG : level === 2 ? H2_FG : H3_FG
    return (
      <Text key={k} color={fg} bold>
        {hMatch[2]!}
      </Text>
    )
  }

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
    return <Text key={k} color={RULE_FG}>{'─'.repeat(60)}</Text>
  }

  // Blockquote
  if (line.startsWith('> ')) {
    return (
      <Box key={k} flexDirection="row">
        <Text color={DIM_FG}>{'│ '}</Text>
        <Text color={DIM_FG}>{parseInline(line.slice(2), k)}</Text>
      </Box>
    )
  }

  // Bullet list
  const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/)
  if (ulMatch) {
    const indent = ' '.repeat(Math.floor((ulMatch[1]?.length ?? 0) / 2) * 2)
    return (
      <Box key={k} flexDirection="row">
        <Text color={dimmed ? THINKING_FG : undefined}>{indent}</Text>
        <Text color={dimmed ? THINKING_FG : BULLET_FG}>{'• '}</Text>
        <Text color={dimmed ? THINKING_FG : undefined}>{parseInline(ulMatch[3]!, k)}</Text>
      </Box>
    )
  }

  // Ordered list
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
  if (olMatch) {
    const indent = ' '.repeat(Math.floor((olMatch[1]?.length ?? 0) / 2) * 2)
    return (
      <Box key={k} flexDirection="row">
        <Text color={dimmed ? THINKING_FG : undefined}>{indent}</Text>
        <Text color={dimmed ? THINKING_FG : BULLET_FG}>{olMatch[2]!}. </Text>
        <Text color={dimmed ? THINKING_FG : undefined}>{parseInline(olMatch[3]!, k)}</Text>
      </Box>
    )
  }

  // Regular paragraph
  return (
    <Text key={k} color={dimmed ? THINKING_FG : undefined}>
      {parseInline(line, k)}
    </Text>
  )
}

interface Props {
  content: string
  streaming?: boolean
  dimmed?: boolean
}

export function MarkdownText({ content, dimmed }: Props) {
  const lines = content.split('\n')
  const result: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!)
        i++
      }
      if (lang) {
        result.push(<Text key={`lang-${i}`} color={dimmed ? THINKING_FG : DIM_FG}>{lang}</Text>)
      }
      for (let ci = 0; ci < codeLines.length; ci++) {
        result.push(
          <Text key={`code-${i}-${ci}`} color={dimmed ? THINKING_FG : CODE_FG}>
            {'  ' + (codeLines[ci] || ' ')}
          </Text>
        )
      }
      i++ // skip closing ```
      continue
    }

    // Empty line
    if (line.trim() === '') {
      result.push(<Text key={`empty-${i}`}>{' '}</Text>)
      i++
      continue
    }

    // Regular formatted line
    result.push(formatLine(line, i, dimmed))
    i++
  }

  return <Box flexDirection="column">{result}</Box>
}
