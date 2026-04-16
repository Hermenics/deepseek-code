import React, { useMemo } from 'react'
import { Text, Box } from 'ink'
import type { ThemeName } from '../setup/ApiKeySetup.js'

interface MarkdownRendererProps {
  content: string
  theme: ThemeName
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, theme }: MarkdownRendererProps) {
  const elements = useMemo(() => parseMarkdown(content, theme), [content, theme])
  return <Box flexDirection="column">{elements}</Box>
})

// ── Syntax highlighting ────────────────────────────────────────────────────────

type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'fn' | 'plain'

interface SyntaxToken { type: TokenType; text: string }

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break',
  'continue','class','extends','new','this','super','import','export','default','from','async',
  'await','try','catch','finally','throw','typeof','instanceof','in','of','void','delete','null',
  'undefined','true','false','type','interface','enum','implements','abstract','readonly','static',
  'public','private','protected','override','declare','namespace','module','require','def','pass',
  'and','or','not','is','lambda','with','yield','raise','except','elif','print','fn','let','mut',
  'use','mod','pub','struct','impl','trait','where','match','Some','None','Ok','Err',
])

const TYPES = new Set([
  'string','number','boolean','object','any','never','unknown','void','Array','Promise','Record',
  'Map','Set','Error','Date','RegExp','Symbol','BigInt','Function','Object','String','Number',
  'Boolean','int','float','str','bool','list','dict','tuple','bytes',
])

function tokenizeLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = []
  let i = 0

  while (i < line.length) {
    // Single-line comment
    if (line[i] === '/' && line[i + 1] === '/') {
      tokens.push({ type: 'comment', text: line.slice(i) })
      break
    }
    if (line[i] === '#') {
      tokens.push({ type: 'comment', text: line.slice(i) })
      break
    }

    // String (single or double quote)
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const q = line[i]!
      let j = i + 1
      while (j < line.length && line[j] !== q) {
        if (line[j] === '\\') j++
        j++
      }
      tokens.push({ type: 'string', text: line.slice(i, j + 1) })
      i = j + 1
      continue
    }

    // Number
    if (/[0-9]/.test(line[i]!) && (i === 0 || /\W/.test(line[i - 1]!))) {
      let j = i
      while (j < line.length && /[0-9._xXa-fA-F]/.test(line[j]!)) j++
      tokens.push({ type: 'number', text: line.slice(i, j) })
      i = j
      continue
    }

    // Word (keyword, type, function call, or plain)
    if (/[a-zA-Z_$]/.test(line[i]!)) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j]!)) j++
      const word = line.slice(i, j)
      const isCall = line[j] === '('
      let type: TokenType = 'plain'
      if (KEYWORDS.has(word)) type = 'keyword'
      else if (TYPES.has(word)) type = 'type'
      else if (isCall) type = 'fn'
      tokens.push({ type, text: word })
      i = j
      continue
    }

    // Plain char
    const last = tokens[tokens.length - 1]
    if (last?.type === 'plain') {
      last.text += line[i]
    } else {
      tokens.push({ type: 'plain', text: line[i]! })
    }
    i++
  }

  return tokens
}

const SYNTAX_LANGS = new Set([
  'ts','tsx','js','jsx','typescript','javascript','python','py','rust','rs','go','java','c','cpp',
  'c++','cs','csharp','swift','kotlin','ruby','rb','php','bash','sh','zsh',
])

function SyntaxLine({ line, theme }: { line: string; theme: ThemeName }) {
  const tokens = tokenizeLine(line)
  const isDark = theme.startsWith('dark')
  return (
    <Text>
      {tokens.map((tok, i) => {
        switch (tok.type) {
          case 'keyword': return <Text key={i} color="magenta">{tok.text}</Text>
          case 'string':  return <Text key={i} color="green">{tok.text}</Text>
          case 'comment': return <Text key={i} color={isDark ? 'gray' : 'gray'} dimColor>{tok.text}</Text>
          case 'number':  return <Text key={i} color="yellow">{tok.text}</Text>
          case 'type':    return <Text key={i} color="cyan">{tok.text}</Text>
          case 'fn':      return <Text key={i} color="blue">{tok.text}</Text>
          default:        return <Text key={i}>{tok.text}</Text>
        }
      })}
    </Text>
  )
}

function parseMarkdown(content: string, theme: ThemeName): React.ReactNode[] {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockLanguage = ''
  let codeBlockContent: string[] = []
  let inList = false
  let listType: 'ordered' | 'unordered' | null = null
  let listItems: React.ReactNode[] = []
  let inTable = false
  let tableRows: string[][] = []
  let elementKey = 0

  const getKey = () => `key-${elementKey++}`

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <Box key={getKey()} flexDirection="column" marginLeft={1} marginY={0}>
          {listItems}
        </Box>
      )
      listItems = []
    }
    inList = false
    listType = null
  }

  const parseTableRow = (line: string) =>
    line.split('|').slice(1, -1).map((c) => c.trim())

  const isSeparator = (line: string) => /^\|[\s|:-]+\|$/.test(line.trim())

  const flushTable = () => {
    if (tableRows.length < 2) { inTable = false; tableRows = []; return }
    const [header, , ...body] = tableRows
    const cols = header!.length
    const widths = Array.from({ length: cols }, (_, ci) =>
      Math.max(header![ci]?.length ?? 0, ...body.map((r) => r[ci]?.length ?? 0))
    )
    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))
    const k = getKey()
    elements.push(
      <Box key={k} flexDirection="column" marginY={1}>
        <Box>
          {header!.map((cell, ci) => (
            <Text key={ci} bold color="cyan"> {pad(cell, widths[ci]!)}  </Text>
          ))}
        </Box>
        <Text dimColor>{'─'.repeat(widths.reduce((a, w) => a + w + 3, 0))}</Text>
        {body.map((row, ri) => (
          <Box key={ri}>
            {Array.from({ length: cols }, (_, ci) => (
              <Text key={ci}> {pad(row[ci] ?? '', widths[ci]!)}  </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
    inTable = false
    tableRows = []
  }

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      const code = codeBlockContent.join('\n')
      const lang = codeBlockLanguage.toLowerCase()
      const highlight = SYNTAX_LANGS.has(lang)
      elements.push(
        <Box key={getKey()} flexDirection="column" borderStyle="single" borderColor="gray" marginY={1} paddingX={1}>
          {codeBlockLanguage && <Text dimColor>{codeBlockLanguage}</Text>}
          {highlight
            ? codeBlockContent.map((line, li) => (
                <SyntaxLine key={li} line={line} theme={theme} />
              ))
            : <Text color={theme.startsWith('dark') ? 'white' : 'black'}>{code}</Text>
          }
        </Box>
      )
      codeBlockContent = []
    }
    inCodeBlock = false
    codeBlockLanguage = ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (line.startsWith('```')) {
      if (inCodeBlock) { flushCodeBlock() }
      else { flushList(); inCodeBlock = true; codeBlockLanguage = line.slice(3).trim() }
      continue
    }
    if (inCodeBlock) { codeBlockContent.push(line); continue }

    if (line.startsWith('# ')) {
      flushList(); flushTable()
      elements.push(<Text key={getKey()} bold color="cyan">{renderInline(line.slice(2), theme, getKey())}</Text>)
      continue
    }
    if (line.startsWith('## ')) {
      flushList()
      elements.push(<Text key={getKey()} bold color="blue">{renderInline(line.slice(3), theme, getKey())}</Text>)
      continue
    }
    if (line.startsWith('### ')) {
      flushList()
      elements.push(<Text key={getKey()} bold color="magenta">{renderInline(line.slice(4), theme, getKey())}</Text>)
      continue
    }

    if (/^---+\s*$/.test(line) || /^___+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flushList()
      elements.push(<Box key={getKey()} marginY={1}><Text dimColor>{'─'.repeat(60)}</Text></Box>)
      continue
    }

    if (line.startsWith('> ')) {
      flushList()
      elements.push(
        <Box key={getKey()} borderLeft borderColor="gray" paddingLeft={1} marginY={1}>
          <Text italic color="gray">{renderInline(line.slice(2), theme, getKey())}</Text>
        </Box>
      )
      continue
    }

    if (line.trim().startsWith('|')) {
      flushList()
      if (isSeparator(line)) tableRows.push([])
      else tableRows.push(parseTableRow(line))
      inTable = true
      continue
    }
    if (inTable) flushTable()

    const orderedMatch = line.match(/^(\d+)\.\s+(.*)/)
    const unorderedMatch = line.match(/^[-*]\s+(.*)/)
    if (orderedMatch || unorderedMatch) {
      const [, number, content] = orderedMatch || []
      const [, unorderedContent] = unorderedMatch || []
      const itemContent = content || unorderedContent || ''
      if (!inList || (orderedMatch && listType !== 'ordered') || (unorderedMatch && listType !== 'unordered')) {
        flushList(); inList = true; listType = orderedMatch ? 'ordered' : 'unordered'
      }
      listItems.push(
        <Box key={getKey()} flexDirection="row" marginBottom={0}>
          <Text>{listType === 'ordered' ? `${number}.` : '•'}</Text>
          <Box marginLeft={1}><Text>{renderInline(itemContent, theme, getKey())}</Text></Box>
        </Box>
      )
      continue
    }

    if (inList && line.trim() !== '') flushList()
    if (line.trim() === '') continue

    flushList()
    elements.push(<Text key={getKey()}>{renderInline(line, theme, getKey())}</Text>)
  }

  flushList(); flushTable(); flushCodeBlock()
  return elements
}

function renderInline(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  const codeMatches = [...text.matchAll(/`([^`]+)`/g)]
  if (codeMatches.length > 0) {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < codeMatches.length; i++) {
      const match = codeMatches[i]!
      const before = text.slice(lastIndex, match.index!)
      if (before) parts.push(processLinks(before, theme, `${baseKey}-b${i}`))
      parts.push(
        <Text key={`${baseKey}-c${i}`} backgroundColor={theme === 'dark' ? '#333' : '#eee'} color={theme === 'dark' ? 'white' : 'black'}>
          {match[1]}
        </Text>
      )
      lastIndex = match.index! + match[0].length
    }
    const after = text.slice(lastIndex)
    if (after) parts.push(processLinks(after, theme, `${baseKey}-a`))
    return <>{parts}</>
  }
  return processLinks(text, theme, baseKey)
}

function processLinks(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g
  const matches = [...text.matchAll(linkRe)]
  if (!matches.length) return processBoldItalic(text, theme, baseKey)
  const parts: React.ReactNode[] = []
  let last = 0
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    if (m.index! > last) parts.push(processBoldItalic(text.slice(last, m.index), theme, `${baseKey}-t${i}`))
    const label = m[1] ?? m[3]!
    const url = m[2] ?? m[3]!
    parts.push(<Text key={`${baseKey}-l${i}`} color="cyan" underline>{label !== url ? `${label} (${url})` : url}</Text>)
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push(processBoldItalic(text.slice(last), theme, `${baseKey}-tail`))
  return <>{parts}</>
}

function processBoldItalic(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  const matches = [...text.matchAll(/\*\*\*(.+?)\*\*\*/g)]
  if (matches.length > 0) {
    const parts: React.ReactNode[] = []
    let last = 0
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!
      if (m.index! > last) parts.push(processBold(text.slice(last, m.index), theme, `${baseKey}-b${i}`))
      parts.push(<Text key={`${baseKey}-bi${i}`} bold italic>{m[1]}</Text>)
      last = m.index! + m[0].length
    }
    const after = text.slice(last)
    if (after) parts.push(processBold(after, theme, `${baseKey}-a`))
    return <>{parts}</>
  }
  return processBold(text, theme, baseKey)
}

function processBold(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  const matches = [...text.matchAll(/\*\*(.+?)\*\*/g)]
  if (matches.length > 0) {
    const parts: React.ReactNode[] = []
    let last = 0
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!
      if (m.index! > last) parts.push(processItalic(text.slice(last, m.index), theme, `${baseKey}-b${i}`))
      parts.push(<Text key={`${baseKey}-bo${i}`} bold>{m[1]}</Text>)
      last = m.index! + m[0].length
    }
    const after = text.slice(last)
    if (after) parts.push(processItalic(after, theme, `${baseKey}-a`))
    return <>{parts}</>
  }
  return processItalic(text, theme, baseKey)
}

function processItalic(text: string, _theme: ThemeName, baseKey: string): React.ReactNode {
  const matches = [...text.matchAll(/(?<![*_])[*_]([^*_]+)[*_](?![*_])/g)]
  if (matches.length > 0) {
    const parts: React.ReactNode[] = []
    let last = 0
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!
      if (m.index! > last) parts.push(<Text key={`${baseKey}-p${i}`}>{text.slice(last, m.index)}</Text>)
      parts.push(<Text key={`${baseKey}-it${i}`} italic>{m[1]}</Text>)
      last = m.index! + m[0].length
    }
    const after = text.slice(last)
    if (after) parts.push(<Text key={`${baseKey}-pa`}>{after}</Text>)
    return <>{parts}</>
  }
  return <Text key={baseKey}>{text}</Text>
}
