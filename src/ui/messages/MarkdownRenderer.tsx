import React from 'react'
import { Text, Box } from 'ink'
import type { ThemeName } from '../setup/ApiKeySetup.js'

interface MarkdownRendererProps {
  content: string
  theme: ThemeName
}

export function MarkdownRenderer({ content, theme }: MarkdownRendererProps) {
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
    // Compute column widths
    const widths = Array.from({ length: cols }, (_, ci) =>
      Math.max(header![ci]?.length ?? 0, ...body.map((r) => r[ci]?.length ?? 0))
    )
    const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))
    const k = getKey()
    elements.push(
      <Box key={k} flexDirection="column" marginY={1}>
        {/* header */}
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
      elements.push(
        <Box key={getKey()} flexDirection="column" borderStyle="single" borderColor="gray" marginY={1} paddingX={1}>
          {codeBlockLanguage && (
            <Text dimColor>```{codeBlockLanguage}</Text>
          )}
          <Text color={theme === 'dark' ? 'white' : 'black'}>{code}</Text>
          <Text dimColor>```</Text>
        </Box>
      )
      codeBlockContent = []
    }
    inCodeBlock = false
    codeBlockLanguage = ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Handle code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock()
      } else {
        flushList()
        inCodeBlock = true
        codeBlockLanguage = line.slice(3).trim()
      }
      continue
    }
    
    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }
    
    // Handle headers
    if (line.startsWith('# ')) {
      flushList()
      flushTable()
      elements.push(
        <Text key={getKey()} bold color="cyan">
          {renderInlineMarkdown(line.slice(2), theme, getKey())}
        </Text>
      )
      continue
    }
    
    if (line.startsWith('## ')) {
      flushList()
      elements.push(
        <Text key={getKey()} bold color="blue">
          {renderInlineMarkdown(line.slice(3), theme, getKey())}
        </Text>
      )
      continue
    }
    
    if (line.startsWith('### ')) {
      flushList()
      elements.push(
        <Text key={getKey()} bold color="magenta">
          {renderInlineMarkdown(line.slice(4), theme, getKey())}
        </Text>
      )
      continue
    }
    
    // Handle horizontal rules
    if (/^---+\s*$/.test(line) || /^___+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flushList()
      elements.push(
        <Box key={getKey()} marginY={1}>
          <Text dimColor>{'─'.repeat(60)}</Text>
        </Box>
      )
      continue
    }
    
    // Handle blockquotes
    if (line.startsWith('> ')) {
      flushList()
      elements.push(
        <Box key={getKey()} borderLeft={true} borderColor="gray" paddingLeft={1} marginY={1}>
          <Text italic color="gray">
            {renderInlineMarkdown(line.slice(2), theme, getKey())}
          </Text>
        </Box>
      )
      continue
    }
    
    // Handle tables
    if (line.trim().startsWith('|')) {
      flushList()
      if (isSeparator(line)) {
        tableRows.push([]) // placeholder for separator row
      } else {
        tableRows.push(parseTableRow(line))
      }
      inTable = true
      continue
    }
    if (inTable) { flushTable() }

    // Handle lists
    const orderedMatch = line.match(/^(\d+)\.\s+(.*)/)
    const unorderedMatch = line.match(/^[-*]\s+(.*)/)
    
    if (orderedMatch || unorderedMatch) {
      const [, number, content] = orderedMatch || []
      const [, unorderedContent] = unorderedMatch || []
      const itemContent = content || unorderedContent || ''
      
      if (!inList || (orderedMatch && listType !== 'ordered') || (unorderedMatch && listType !== 'unordered')) {
        flushList()
        inList = true
        listType = orderedMatch ? 'ordered' : 'unordered'
      }
      
      listItems.push(
        <Box key={getKey()} flexDirection="row" marginBottom={0}>
          <Text>
            {listType === 'ordered' ? `${number}.` : '•'}
          </Text>
          <Box marginLeft={1}>
            <Text>{renderInlineMarkdown(itemContent, theme, getKey())}</Text>
          </Box>
        </Box>
      )
      continue
    }
    
    // If we were in a list and this line is not a list item, flush the list
    if (inList && line.trim() !== '') {
      flushList()
    }
    
    // Handle empty lines
    if (line.trim() === '') {
      continue
    }
    
    // Regular text with inline formatting
    flushList()
    elements.push(
      <Text key={getKey()}>
        {renderInlineMarkdown(line, theme, getKey())}
      </Text>
    )
  }
  
  flushList()
  flushTable()
  flushCodeBlock()
  
  return (
    <Box flexDirection="column">
      {elements}
    </Box>
  )
}

function renderInlineMarkdown(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  // Process inline code first
  const codeMatches = [...text.matchAll(/`([^`]+)`/g)]
  if (codeMatches.length > 0) {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < codeMatches.length; i++) {
      const match = codeMatches[i]
      const matchIndex = match.index!
      const before = text.slice(lastIndex, matchIndex)
      if (before) parts.push(processLinks(before, theme, `${baseKey}-before-${i}`))
      parts.push(
        <Text key={`${baseKey}-code-${i}`} backgroundColor={theme === 'dark' ? '#333' : '#eee'} color={theme === 'dark' ? 'white' : 'black'}>
          {match[1]}
        </Text>
      )
      lastIndex = matchIndex + match[0].length
    }
    const after = text.slice(lastIndex)
    if (after) parts.push(processLinks(after, theme, `${baseKey}-after`))
    return <>{parts}</>
  }

  return processLinks(text, theme, baseKey)
}

function processLinks(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  // [label](url) and bare URLs
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g
  const matches = [...text.matchAll(linkRe)]
  if (!matches.length) return processBoldItalic(text, theme, baseKey)

  const parts: React.ReactNode[] = []
  let last = 0
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    if (m.index! > last) parts.push(processBoldItalic(text.slice(last, m.index), theme, `${baseKey}-t-${i}`))
    const label = m[1] ?? m[3]!
    const url   = m[2] ?? m[3]!
    parts.push(
      <Text key={`${baseKey}-link-${i}`} color="cyan" underline>
        {label !== url ? `${label} (${url})` : url}
      </Text>
    )
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push(processBoldItalic(text.slice(last), theme, `${baseKey}-tail`))
  return <>{parts}</>
}

function processBoldItalic(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  // First, process bold italic
  const boldItalicRegex = /\*\*\*(.+?)\*\*\*/g
  let matches = [...text.matchAll(boldItalicRegex)]
  if (matches.length > 0) {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const matchIndex = match.index!
      const before = text.slice(lastIndex, matchIndex)
      if (before) {
        parts.push(processBold(before, theme, `${baseKey}-before-${i}`))
      }
      parts.push(
        <Text key={`${baseKey}-bolditalic-${i}`} bold italic>
          {match[1]}
        </Text>
      )
      lastIndex = matchIndex + match[0].length
    }
    const after = text.slice(lastIndex)
    if (after) {
      parts.push(processBold(after, theme, `${baseKey}-after`))
    }
    return <>{parts}</>
  }
  
  return processBold(text, theme, baseKey)
}

function processBold(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  const boldRegex = /\*\*(.+?)\*\*/g
  let matches = [...text.matchAll(boldRegex)]
  if (matches.length > 0) {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const matchIndex = match.index!
      const before = text.slice(lastIndex, matchIndex)
      if (before) {
        parts.push(processItalic(before, theme, `${baseKey}-before-${i}`))
      }
      parts.push(
        <Text key={`${baseKey}-bold-${i}`} bold>
          {match[1]}
        </Text>
      )
      lastIndex = matchIndex + match[0].length
    }
    const after = text.slice(lastIndex)
    if (after) {
      parts.push(processItalic(after, theme, `${baseKey}-after`))
    }
    return <>{parts}</>
  }
  
  return processItalic(text, theme, baseKey)
}

function processItalic(text: string, theme: ThemeName, baseKey: string): React.ReactNode {
  const italicRegex = /(?<![*_])[*_]([^*_]+)[*_](?![*_])/g
  let matches = [...text.matchAll(italicRegex)]
  if (matches.length > 0) {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const matchIndex = match.index!
      const before = text.slice(lastIndex, matchIndex)
      if (before) {
        parts.push(<Text key={`${baseKey}-plain-${i}`}>{before}</Text>)
      }
      parts.push(
        <Text key={`${baseKey}-italic-${i}`} italic>
          {match[1]}
        </Text>
      )
      lastIndex = matchIndex + match[0].length
    }
    const after = text.slice(lastIndex)
    if (after) {
      parts.push(<Text key={`${baseKey}-plain-after`}>{after}</Text>)
    }
    return <>{parts}</>
  }
  
  return <Text key={baseKey}>{text}</Text>
}