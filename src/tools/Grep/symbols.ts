interface SymbolPosition {
  line: number
  character: number
}

interface SymbolRange {
  start: SymbolPosition
  end: SymbolPosition
}

function safeSymbolName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120).join('')
  return name || undefined
}

function symbolRange(value: unknown): SymbolRange | undefined {
  if (!value || typeof value !== 'object') return undefined
  const range = value as Partial<SymbolRange>
  const position = (item: unknown): item is SymbolPosition => Boolean(item && typeof item === 'object'
    && Number.isSafeInteger((item as SymbolPosition).line) && (item as SymbolPosition).line >= 0 && (item as SymbolPosition).line <= 2_147_483_647
    && Number.isSafeInteger((item as SymbolPosition).character) && (item as SymbolPosition).character >= 0 && (item as SymbolPosition).character <= 2_147_483_647)
  if (!position(range.start) || !position(range.end)) return undefined
  if (range.end.line < range.start.line || range.end.line === range.start.line && range.end.character < range.start.character) return undefined
  return range as SymbolRange
}

function containsLine(range: SymbolRange, line: number): boolean {
  return range.start.line <= line && (line < range.end.line || line === range.end.line && range.end.character > 0)
}

/** Return the narrowest nested LSP symbol containing a 1-based grep line. */
export function symbolPathForLine(input: unknown, lineNumber: number, documentUri?: string): string | undefined {
  if (!Array.isArray(input) || !Number.isInteger(lineNumber) || lineNumber < 1) return undefined
  const targetLine = lineNumber - 1
  let best: { path: string; depth: number; span: number } | undefined

  const visit = (symbols: unknown[], parents: string[], depth = 0) => {
    // shortcut: ignore nesting beyond 64; raise only if a supported language server needs deeper trees.
    if (depth > 64) return
    for (const item of symbols) {
      if (!item || typeof item !== 'object') continue
      const symbol = item as { name?: unknown; containerName?: unknown; range?: unknown; location?: { range?: unknown }; children?: unknown }
      if (symbol.location && documentUri && (symbol.location as { uri?: unknown }).uri !== documentUri) continue
      const range = symbolRange(symbol.range) ?? symbolRange(symbol.location?.range)
      if (!range || !containsLine(range, targetLine)) continue
      const container = safeSymbolName(symbol.containerName)
      const name = safeSymbolName(symbol.name)
      const path = [...parents, ...(container && parents.at(-1) !== container ? [container] : []), ...(name ? [name] : [])]
      const span = range.end.line - range.start.line
      if (path.length && (!best || path.length > best.depth || path.length === best.depth && span < best.span)) {
        best = { path: path.join(' > '), depth: path.length, span }
      }
      if (Array.isArray(symbol.children)) visit(symbol.children, path, depth + 1)
    }
  }

  visit(input, [])
  return best?.path
}
