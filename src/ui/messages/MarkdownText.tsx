/**
 * Markdown renderer using native OpenTUI components for inline formatting.
 * Uses <b>, <i>, <span fg={color}> instead of ANSI escape codes to avoid
 * layout and wrapping issues.
 */

import { Fragment } from 'react'

const CODE_FG = '#c3e88d'
const H1_FG = '#82aaff'
const H2_FG = '#89ddff'
const H3_FG = '#c792ea'
const BULLET_FG = '#00cccc'
const DIM_FG = '#888888'
const RULE_FG = '#444444'

function parseInline(line: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let i = 0
  let buf = ''

  const flush = () => {
    if (buf) {
      parts.push(buf)
      buf = ''
    }
  }

  while (i < line.length) {
    // Bold+italic: ***text***
    if (line.startsWith('***', i)) {
      const end = line.indexOf('***', i + 3)
      if (end !== -1) {
        flush()
        parts.push(<b key={`bi-${i}`}><i>{line.slice(i + 3, end)}</i></b>)
        i = end + 3
        continue
      }
    }
    // Bold: **text**
    if (line.startsWith('**', i)) {
      const end = line.indexOf('**', i + 2)
      if (end !== -1) {
        flush()
        parts.push(<b key={`b-${i}`}>{line.slice(i + 2, end)}</b>)
        i = end + 2
        continue
      }
    }
    // Italic: *text* (mas não **)
    if (line[i] === '*' && line[i + 1] !== '*') {
      const end = line.indexOf('*', i + 1)
      if (end !== -1 && end > i + 1) {
        flush()
        parts.push(<i key={`i-${i}`}>{line.slice(i + 1, end)}</i>)
        i = end + 1
        continue
      }
    }
    // Inline code: `text`
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        parts.push(<span key={`c-${i}`} fg={CODE_FG}>{line.slice(i + 1, end)}</span>)
        i = end + 1
        continue
      }
    }
    buf += line[i]
    i++
  }
  flush()

  if (parts.length === 1) return parts[0]
  return parts
}

function formatLine(line: string, lineIdx: number): React.ReactNode {
  // Heading
  const hMatch = line.match(/^(#{1,6})\s+(.*)$/)
  if (hMatch) {
    const level = hMatch[1]!.length
    const fg = level === 1 ? H1_FG : level === 2 ? H2_FG : H3_FG
    return (
      <text key={`h-${lineIdx}`} fg={fg}>
        <b>{hMatch[2]!}</b>
      </text>
    )
  }

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
    return <text key={`hr-${lineIdx}`} fg={RULE_FG}>{'─'.repeat(60)}</text>
  }

  // Blockquote
  if (line.startsWith('> ')) {
    return (
      <text key={`q-${lineIdx}`} fg={DIM_FG}>
        <span fg={DIM_FG}>{'│ '}</span>
        {parseInline(line.slice(2))}
      </text>
    )
  }

  // Bullet list
  const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/)
  if (ulMatch) {
    const indent = ' '.repeat(Math.floor((ulMatch[1]?.length ?? 0) / 2) * 2)
    return (
      <text key={`ul-${lineIdx}`}>
        {indent}
        <span fg={BULLET_FG}>{'• '}</span>
        {parseInline(ulMatch[3]!)}
      </text>
    )
  }

  // Ordered list
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
  if (olMatch) {
    const indent = ' '.repeat(Math.floor((olMatch[1]?.length ?? 0) / 2) * 2)
    return (
      <text key={`ol-${lineIdx}`}>
        {indent}
        <span fg={BULLET_FG}>{olMatch[2]!}.{' '}</span>
        {parseInline(olMatch[3]!)}
      </text>
    )
  }

  // Regular paragraph
  return <text key={`p-${lineIdx}`}>{parseInline(line)}</text>
}

interface Props {
  content: string
  streaming?: boolean
}

export function MarkdownText({ content }: Props) {
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
        result.push(<text key={`lang-${i}`} fg={DIM_FG}>{lang}</text>)
      }
      for (let ci = 0; ci < codeLines.length; ci++) {
        result.push(<text key={`code-${i}-${ci}`} fg={CODE_FG}>{'  ' + (codeLines[ci] || ' ')}</text>)
      }
      i++ // skip closing ```
      continue
    }

    // Empty line
    if (line.trim() === '') {
      result.push(<text key={`empty-${i}`}>{' '}</text>)
      i++
      continue
    }

    // Regular formatted line
    result.push(formatLine(line, i))
    i++
  }

  return <box flexDirection="column">{result}</box>
}
