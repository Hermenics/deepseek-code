/**
 * Simple markdown renderer using plain <text> components with OpenTUI attributes.
 * Replaces the broken <markdown> OpenTUI component.
 *
 * TextAttributes: BOLD = 1 << 0 = 1, ITALIC = 1 << 2 = 4
 */

const ATTR_BOLD = 1
const ATTR_ITALIC = 4
const ATTR_BOLD_ITALIC = ATTR_BOLD | ATTR_ITALIC

interface Segment {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

function parseInline(line: string): Segment[] {
  const segments: Segment[] = []
  let i = 0

  while (i < line.length) {
    // Bold+italic: ***text*** or ___text___
    if (
      (line[i] === '*' && line[i + 1] === '*' && line[i + 2] === '*') ||
      (line[i] === '_' && line[i + 1] === '_' && line[i + 2] === '_')
    ) {
      const marker = line[i]!.repeat(3)
      const end = line.indexOf(marker, i + 3)
      if (end !== -1) {
        segments.push({ text: line.slice(i + 3, end), bold: true, italic: true })
        i = end + 3
        continue
      }
    }
    // Bold: **text** or __text__
    if (
      (line[i] === '*' && line[i + 1] === '*') ||
      (line[i] === '_' && line[i + 1] === '_')
    ) {
      const marker = line[i]!.repeat(2)
      const end = line.indexOf(marker, i + 2)
      if (end !== -1) {
        segments.push({ text: line.slice(i + 2, end), bold: true })
        i = end + 2
        continue
      }
    }
    // Italic: *text* or _text_ (only single, not double)
    if ((line[i] === '*' && line[i + 1] !== '*') || (line[i] === '_' && line[i + 1] !== '_')) {
      const marker = line[i]!
      const end = line.indexOf(marker, i + 1)
      if (end !== -1 && end > i + 1) {
        segments.push({ text: line.slice(i + 1, end), italic: true })
        i = end + 1
        continue
      }
    }
    // Inline code: `text`
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1) {
        segments.push({ text: line.slice(i + 1, end), code: true })
        i = end + 1
        continue
      }
    }
    // Regular character — accumulate into last plain segment
    const last = segments[segments.length - 1]
    if (last && !last.bold && !last.italic && !last.code) {
      last.text += line[i]
    } else {
      segments.push({ text: line[i]! })
    }
    i++
  }

  return segments.filter((s) => s.text.length > 0)
}

function InlineSegments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.code) {
          return <text key={i} fg="#c3e88d">{seg.text}</text>
        }
        if (seg.bold && seg.italic) {
          return <text key={i} attributes={ATTR_BOLD_ITALIC}>{seg.text}</text>
        }
        if (seg.bold) {
          return <text key={i} attributes={ATTR_BOLD}>{seg.text}</text>
        }
        if (seg.italic) {
          return <text key={i} attributes={ATTR_ITALIC}>{seg.text}</text>
        }
        return <text key={i}>{seg.text}</text>
      })}
    </>
  )
}

function MarkdownLine({ line }: { line: string }) {
  // Heading
  const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
  if (headingMatch) {
    const level = headingMatch[1]!.length
    const text = headingMatch[2]!
    const headingFg = level === 1 ? '#82aaff' : level === 2 ? '#89ddff' : '#c792ea'
    return (
      <box flexDirection="row">
        <text fg={headingFg} attributes={ATTR_BOLD}>{text}</text>
      </box>
    )
  }

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
    return <text fg="#444444">{'─'.repeat(60)}</text>
  }

  // Blockquote
  if (line.startsWith('> ')) {
    const segs = parseInline(line.slice(2))
    return (
      <box flexDirection="row" gap={1}>
        <text fg="#555555">{'│'}</text>
        <box flexDirection="row" flexShrink={1}>
          {segs.map((seg, i) => (
            <text key={i} fg="#888888">{seg.text}</text>
          ))}
        </box>
      </box>
    )
  }

  // Bullet list
  const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/)
  if (bulletMatch) {
    const indent = Math.floor((bulletMatch[1]?.length ?? 0) / 2)
    const content = bulletMatch[3]!
    const segs = parseInline(content)
    return (
      <box flexDirection="row">
        {indent > 0 && <text>{' '.repeat(indent * 2)}</text>}
        <text fg="cyan">{'• '}</text>
        <box flexDirection="row" flexShrink={1}>
          <InlineSegments segments={segs} />
        </box>
      </box>
    )
  }

  // Numbered list
  const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/)
  if (numberedMatch) {
    const indent = Math.floor((numberedMatch[1]?.length ?? 0) / 2)
    const num = numberedMatch[2]!
    const content = numberedMatch[3]!
    const segs = parseInline(content)
    return (
      <box flexDirection="row">
        {indent > 0 && <text>{' '.repeat(indent * 2)}</text>}
        <text fg="cyan">{num + '. '}</text>
        <box flexDirection="row" flexShrink={1}>
          <InlineSegments segments={segs} />
        </box>
      </box>
    )
  }

  // Empty line
  if (line.trim() === '') {
    return <text>{' '}</text>
  }

  // Regular paragraph line with inline formatting
  const segs = parseInline(line)
  return (
    <box flexDirection="row" flexShrink={1}>
      <InlineSegments segments={segs} />
    </box>
  )
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
      result.push(
        <box key={`code-${i}`} flexDirection="column" marginTop={1} marginBottom={1}>
          {lang && <text fg="#888888">{lang}</text>}
          <box flexDirection="column" paddingLeft={1}>
            {codeLines.map((cl, ci) => (
              <text key={ci} fg="#c3e88d">{cl || ' '}</text>
            ))}
          </box>
        </box>
      )
      i++ // skip closing ```
      continue
    }

    result.push(<MarkdownLine key={`line-${i}`} line={line} />)
    i++
  }

  return <box flexDirection="column">{result}</box>
}
