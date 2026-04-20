import React, { useMemo } from 'react'
import { Text, Box } from 'ink'
import chalk from 'chalk'
import figures from 'figures'
import { marked, type Token, type Tokens } from 'marked'
import hljs from 'highlight.js'
import supportsHyperlinks from 'supports-hyperlinks'
import stripAnsi from 'strip-ansi'
import wrapAnsi from 'wrap-ansi'
import cliBoxes from 'cli-boxes'
import type { ThemeName } from '../setup/ApiKeySetup.js'

interface MarkdownRendererProps {
  content: string
  theme: ThemeName
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, theme }: MarkdownRendererProps) {
  const elements = useMemo(() => renderTokens(marked.lexer(content), theme), [content, theme])
  return <Box flexDirection="column">{elements}</Box>
})

// ── Hyperlink support detection (cached once) ─────────────────────────────────

const hyperlinksSupported = supportsHyperlinks.stdout

/**
 * OSC 8 hyperlink escape: \e]8;;URL\e\\LABEL\e]8;;\e\\
 * Falls back to "LABEL (URL)" when terminal doesn't support it.
 */
function makeLink(url: string, label: string): string {
  if (hyperlinksSupported) {
    return `\u001B]8;;${url}\u001B\\${label}\u001B]8;;\u001B\\`
  }
  return label === url ? url : `${label} (${url})`
}

// ── highlight.js → chalk ANSI conversion ──────────────────────────────────────

/** Maps hljs CSS class → chalk color function */
const HLS_CLASS_COLORS: Record<string, (s: string) => string> = {
  'hljs-keyword':    (s) => chalk.magenta(s),
  'hljs-built_in':   (s) => chalk.cyan(s),
  'hljs-type':       (s) => chalk.cyan.bold(s),
  'hljs-literal':    (s) => chalk.yellow(s),
  'hljs-number':     (s) => chalk.yellow(s),
  'hljs-string':     (s) => chalk.green(s),
  'hljs-comment':    (s) => chalk.gray(s),
  'hljs-doctag':     (s) => chalk.gray.bold(s),
  'hljs-meta':       (s) => chalk.gray(s),
  'hljs-attr':       (s) => chalk.blue(s),
  'hljs-params':     (s) => chalk.white(s),
  'hljs-variable':   (s) => chalk.red(s),
  'hljs-regexp':     (s) => chalk.red(s),
  'hljs-symbol':     (s) => chalk.yellow(s),
  'hljs-selector-tag':   (s) => chalk.magenta(s),
  'hljs-selector-class': (s) => chalk.blue(s),
  'hljs-selector-id':    (s) => chalk.cyan(s),
  'hljs-property':       (s) => chalk.blue(s),
  'hljs-addition':       (s) => chalk.green(s),
  'hljs-deletion':       (s) => chalk.red(s),
}

/** Matches class names like "hljs-title function_" → uses "hljs-title" prefix */
function getColorFn(className: string): ((s: string) => string) | null {
  if (HLS_CLASS_COLORS[className]) return HLS_CLASS_COLORS[className]!
  // Handle compound classes: "hljs-title function_" → try "hljs-title"
  const base = className.split(' ')[0]!
  if (HLS_CLASS_COLORS[base]) return HLS_CLASS_COLORS[base]!
  // Common hljs-title patterns (class names, function names)
  if (className.includes('function_')) return (s) => chalk.blue(s)
  if (className.includes('class_')) return (s) => chalk.cyan.bold(s)
  if (className.startsWith('hljs-title')) return (s) => chalk.blue(s)
  return null
}

/** Converts highlight.js HTML output to a chalk-colored ANSI string */
function hljsHtmlToAnsi(html: string): string {
  // Process span tags from hljs output, converting to chalk colors
  let result = ''
  let i = 0

  while (i < html.length) {
    // Opening span tag
    if (html.startsWith('<span class="', i)) {
      const classStart = i + 13 // length of '<span class="'
      const classEnd = html.indexOf('"', classStart)
      if (classEnd === -1) { result += html[i]; i++; continue }
      const className = html.slice(classStart, classEnd)
      const tagEnd = html.indexOf('>', classEnd)
      if (tagEnd === -1) { result += html[i]; i++; continue }

      // Find matching </span> — handle nested spans
      let depth = 1
      let j = tagEnd + 1
      while (j < html.length && depth > 0) {
        if (html.startsWith('<span', j)) depth++
        else if (html.startsWith('</span>', j)) depth--
        if (depth > 0) j++
        else break
      }

      const innerHtml = html.slice(tagEnd + 1, j)
      // Recursively process inner content (handles nested spans)
      const innerAnsi = hljsHtmlToAnsi(innerHtml)
      const colorFn = getColorFn(className)
      result += colorFn ? colorFn(innerAnsi) : innerAnsi
      i = j + 7 // skip past </span>
      continue
    }

    // HTML entity decoding
    if (html.startsWith('&amp;', i)) { result += '&'; i += 5; continue }
    if (html.startsWith('&lt;', i)) { result += '<'; i += 4; continue }
    if (html.startsWith('&gt;', i)) { result += '>'; i += 4; continue }
    if (html.startsWith('&quot;', i)) { result += '"'; i += 6; continue }
    if (html.startsWith('&#x27;', i) || html.startsWith('&#39;', i)) {
      result += "'"; i += html.startsWith('&#x27;', i) ? 6 : 5; continue
    }

    result += html[i]
    i++
  }

  return result
}

// ── Languages that highlight.js can handle ────────────────────────────────────

const HLJS_LANG_ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', zsh: 'bash',
  yml: 'yaml', 'c++': 'cpp', cs: 'csharp', kt: 'kotlin',
  md: 'markdown', tf: 'hcl', dockerfile: 'dockerfile',
}

function resolveLanguage(lang: string): string | null {
  const lower = lang.toLowerCase()
  const resolved = HLJS_LANG_ALIASES[lower] ?? lower
  return hljs.getLanguage(resolved) ? resolved : null
}

// ── Syntax-highlighted code block ─────────────────────────────────────────────

function highlightCode(code: string, lang: string): string {
  const resolved = resolveLanguage(lang)
  if (!resolved) return code
  try {
    const result = hljs.highlight(code, { language: resolved })
    return hljsHtmlToAnsi(result.value)
  } catch {
    // Fallback to plain text if highlighting fails
    return code
  }
}

// ── Token rendering ───────────────────────────────────────────────────────────

let _keyCounter = 0
const getKey = () => `md-${_keyCounter++}`

function renderTokens(tokens: Token[], theme: ThemeName): React.ReactNode[] {
  // Reset key counter per render pass
  _keyCounter = 0
  return tokens.map((token) => renderToken(token, theme))
}

function renderToken(token: Token, theme: ThemeName): React.ReactNode {
  const isDark = theme.startsWith('dark')

  switch (token.type) {
    case 'heading': {
      const t = token as Tokens.Heading
      if (t.depth === 1) {
        return (
          <Box key={getKey()} marginTop={1}>
            <Text bold color="cyan">{figures.pointer} {renderInlineTokens(t.tokens, theme)}</Text>
          </Box>
        )
      }
      if (t.depth === 2) {
        return (
          <Box key={getKey()} marginTop={1}>
            <Text bold color="blue">{figures.pointerSmall} {renderInlineTokens(t.tokens, theme)}</Text>
          </Box>
        )
      }
      return <Text key={getKey()} bold color="magenta">{renderInlineTokens(t.tokens, theme)}</Text>
    }

    case 'paragraph': {
      const t = token as Tokens.Paragraph
      const raw = renderInlineTokensToString(t.tokens, theme)
      const cols = process.stdout.columns ?? 80
      // Wrap long paragraphs to terminal width minus some margin
      if (stripAnsi(raw).length > cols - 4) {
        const wrapped = wrapAnsi(raw, cols - 4, { hard: true })
        return (
          <Box key={getKey()} flexDirection="column">
            {wrapped.split('\n').map((line, li) => <Text key={li}>{line}</Text>)}
          </Box>
        )
      }
      return <Text key={getKey()}>{renderInlineTokens(t.tokens, theme)}</Text>
    }

    case 'code': {
      const t = token as Tokens.Code
      const lang = t.lang ?? ''
      const highlighted = lang ? highlightCode(t.text, lang) : t.text
      const langLabel = lang ? chalk.bgGray.white.bold(` ${lang} `) : ''
      const box = cliBoxes.round
      const borderColor = isDark ? chalk.gray : chalk.hex('#888')
      const cols = process.stdout.columns ?? 80
      const innerWidth = Math.max(cols - 6, 30)

      // Build code lines with wrapping for long lines
      const codeLines = (lang && resolveLanguage(lang))
        ? wrapAnsi(highlighted, innerWidth, { hard: true }).split('\n')
        : wrapAnsi(t.text, innerWidth, { hard: true }).split('\n')

      // Find max visible width for the box
      const maxLineWidth = Math.max(...codeLines.map((l) => stripAnsi(l).length), langLabel ? stripAnsi(langLabel).length : 0)
      const boxWidth = Math.min(maxLineWidth + 2, innerWidth + 2) // +2 for padding

      const topBorder = borderColor(box.topLeft + box.top.repeat(boxWidth) + box.topRight)
      const bottomBorder = borderColor(box.bottomLeft + box.bottom.repeat(boxWidth) + box.bottomRight)

      const padLine = (line: string) => {
        const visible = stripAnsi(line).length
        const right = Math.max(0, boxWidth - visible - 1)
        return borderColor(box.left) + ' ' + line + ' '.repeat(right) + borderColor(box.right)
      }

      const renderedLines: string[] = []
      if (langLabel) renderedLines.push(padLine(langLabel))
      for (const line of codeLines) renderedLines.push(padLine(line))

      const boxStr = [topBorder, ...renderedLines, bottomBorder].join('\n')
      return (
        <Box key={getKey()} flexDirection="column" marginY={1}>
          {boxStr.split('\n').map((line, li) => <Text key={li}>{line}</Text>)}
        </Box>
      )
    }

    case 'blockquote': {
      const t = token as Tokens.Blockquote
      return (
        <Box key={getKey()} borderLeft borderColor="cyan" paddingLeft={1} marginY={1}>
          <Text italic color="gray">{figures.lineVertical} {renderInlineTokens(t.tokens as Token[], theme)}</Text>
        </Box>
      )
    }

    case 'list': {
      const t = token as Tokens.List
      return (
        <Box key={getKey()} flexDirection="column" marginLeft={1} marginY={0}>
          {t.items.map((item, idx) => {
            const bullet = t.ordered
              ? <Text color="yellow">{Number(t.start ?? 1) + idx}.</Text>
              : <Text color="cyan">{figures.bullet}</Text>
            return (
              <Box key={getKey()} flexDirection="row" marginBottom={0}>
                {bullet}
                <Box marginLeft={1} flexDirection="column">
                  {item.tokens.map((sub) => renderToken(sub, theme))}
                </Box>
              </Box>
            )
          })}
        </Box>
      )
    }

    case 'table': {
      const t = token as Tokens.Table
      const cols = t.header.length
      const headerTexts = t.header.map((h) => renderInlineTokensToString(h.tokens, theme))
      const bodyTexts = t.rows.map((row) => row.map((cell) => renderInlineTokensToString(cell.tokens, theme)))
      // Use strip-ansi for accurate column width calculation
      const widths = Array.from({ length: cols }, (_, ci) =>
        Math.max(
          stripAnsi(headerTexts[ci] ?? '').length,
          ...bodyTexts.map((r) => stripAnsi(r[ci] ?? '').length)
        )
      )
      const pad = (s: string, w: number) => {
        const visible = stripAnsi(s).length
        return s + ' '.repeat(Math.max(0, w - visible))
      }
      // Use cli-boxes single style for table separator
      const box = cliBoxes.single
      const separator = widths.map((w) => box.top.repeat(w + 2)).join(box.top)
      return (
        <Box key={getKey()} flexDirection="column" marginY={1}>
          <Box>
            {headerTexts.map((cell, ci) => (
              <Text key={ci} bold color="cyan"> {pad(cell, widths[ci]!)}  </Text>
            ))}
          </Box>
          <Text dimColor>{separator}</Text>
          {bodyTexts.map((row, ri) => (
            <Box key={ri}>
              {Array.from({ length: cols }, (_, ci) => (
                <Text key={ci}> {pad(row[ci] ?? '', widths[ci]!)}  </Text>
              ))}
            </Box>
          ))}
        </Box>
      )
    }

    case 'hr': {
      const hrWidth = Math.min((process.stdout.columns ?? 80) - 4, 76)
      return <Box key={getKey()} marginY={1}><Text dimColor>{cliBoxes.single.top.repeat(hrWidth)}</Text></Box>
    }

    case 'space':
      return null

    case 'html': {
      // Render raw HTML as plain text in terminal
      const t = token as Tokens.HTML
      return t.text.trim() ? <Text key={getKey()} dimColor>{t.text.trim()}</Text> : null
    }

    default: {
      // Fallback: render raw text for any unhandled token type
      if ('text' in token && typeof token.text === 'string') {
        return <Text key={getKey()}>{token.text}</Text>
      }
      return null
    }
  }
}

// ── Inline token rendering (bold, italic, code, links) ───────────────────────

function renderInlineTokens(tokens: Token[], theme: ThemeName): React.ReactNode {
  if (!tokens || tokens.length === 0) return null
  const parts = tokens.map((t) => renderInlineToken(t, theme))
  return <>{parts}</>
}

function renderInlineToken(token: Token, theme: ThemeName): React.ReactNode {
  const isDark = theme.startsWith('dark')

  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text
      // Text tokens can have nested tokens (e.g. inside list items)
      if ('tokens' in t && t.tokens && t.tokens.length > 0) {
        return <React.Fragment key={getKey()}>{renderInlineTokens(t.tokens, theme)}</React.Fragment>
      }
      return <Text key={getKey()}>{t.text}</Text>
    }

    case 'strong': {
      const t = token as Tokens.Strong
      return <Text key={getKey()} bold>{renderInlineTokens(t.tokens, theme)}</Text>
    }

    case 'em': {
      const t = token as Tokens.Em
      return <Text key={getKey()} italic>{renderInlineTokens(t.tokens, theme)}</Text>
    }

    case 'codespan': {
      const t = token as Tokens.Codespan
      return (
        <Text key={getKey()} backgroundColor={isDark ? '#333' : '#eee'} color={isDark ? 'white' : 'black'}>
          {t.text}
        </Text>
      )
    }

    case 'link': {
      const t = token as Tokens.Link
      const label = t.tokens ? renderInlineTokensToString(t.tokens, theme) : t.text
      const linked = makeLink(t.href, label)
      return <Text key={getKey()} color="cyan" underline>{linked}</Text>
    }

    case 'image': {
      const t = token as Tokens.Image
      return <Text key={getKey()} color="cyan" dimColor>[img: {t.text || t.href}]</Text>
    }

    case 'br':
      return <Text key={getKey()}>{'\n'}</Text>

    case 'del': {
      const t = token as Tokens.Del
      return <Text key={getKey()} strikethrough>{renderInlineTokens(t.tokens, theme)}</Text>
    }

    case 'escape': {
      const t = token as Tokens.Escape
      return <Text key={getKey()}>{t.text}</Text>
    }

    default: {
      if ('text' in token && typeof token.text === 'string') {
        return <Text key={getKey()}>{token.text}</Text>
      }
      if ('raw' in token && typeof token.raw === 'string') {
        return <Text key={getKey()}>{token.raw}</Text>
      }
      return null
    }
  }
}

/** Flattens inline tokens to a plain string (for table width calculation) */
function renderInlineTokensToString(tokens: Token[], _theme: ThemeName): string {
  if (!tokens) return ''
  return tokens.map((t) => {
    if ('tokens' in t && Array.isArray(t.tokens)) {
      return renderInlineTokensToString(t.tokens, _theme)
    }
    if ('text' in t && typeof t.text === 'string') return t.text
    return ''
  }).join('')
}
