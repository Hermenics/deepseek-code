import stringWidth from 'string-width'

type Position = { line: number; column: number }
type WordBoundary = { start: number; end: number; isWordLike: boolean }
type VisualLine = { start: number; end: number }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Visual lines of `text` as [start, end) offsets: split on newlines, then word-wrapped at `width` display columns, breaking after the last space that fits (the space itself is not drawn) and force-breaking a longer word between graphemes. The input renderer and cursor movement both use this, so arrows move over exactly the lines on screen. */
export function wrapVisualLines(text: string, width: number): VisualLine[] {
  const max = Math.max(1, width)
  const lines: VisualLine[] = []
  let lineStart = 0
  for (const line of text.split('\n')) {
    let start = 0
    let used = 0
    let lastSpace = -1
    let pushed = false
    const push = (end: number) => { lines.push({ start: lineStart + start, end: lineStart + end }); pushed = true }
    for (const { index, segment } of graphemes.segment(line)) {
      const cells = stringWidth(segment)
      if (used + cells > max && index > start) {
        if (segment === ' ') {
          // The overflowing grapheme is the break itself: end here and swallow it.
          push(index)
          start = index + 1
          used = 0
          lastSpace = -1
          continue
        }
        if (lastSpace > start) {
          push(lastSpace)
          start = lastSpace + 1
        } else {
          push(index)
          start = index
        }
        used = stringWidth(line.slice(start, index))
        lastSpace = -1
      }
      if (segment === ' ') lastSpace = index
      used += cells
    }
    // A break that swallowed a trailing space leaves nothing to draw, so no empty line follows it.
    if (start < line.length || !pushed) push(line.length)
    lineStart += line.length + 1
  }
  return lines
}

/** Text plus wrap width with precomputed grapheme and word boundaries (Intl.Segmenter) for cursor math. The text is NFC-normalized, so offsets refer to the normalized string. */
export class MeasuredText {
  readonly text: string
  readonly columns: number

  private readonly graphemeBoundaries: number[]
  private readonly wordBoundaries: WordBoundary[]
  private wrappedTextCache: string[] | null = null
  private visualLinesCache: VisualLine[] | null = null

  private static graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  })

  private static wordSegmenter = new Intl.Segmenter(undefined, {
    granularity: 'word',
  })

  constructor(text: string, columns: number) {
    this.text = text.normalize('NFC')
    this.columns = Math.max(1, columns)

    const boundaries: number[] = [0]
    for (const { index, segment } of MeasuredText.graphemeSegmenter.segment(this.text)) {
      const end = index + segment.length
      if (end > boundaries[boundaries.length - 1]!) boundaries.push(end)
    }
    if (boundaries[boundaries.length - 1] !== this.text.length) {
      boundaries.push(this.text.length)
    }
    this.graphemeBoundaries = boundaries

    const words: WordBoundary[] = []
    for (const part of MeasuredText.wordSegmenter.segment(this.text)) {
      words.push({
        start: part.index,
        end: part.index + part.segment.length,
        isWordLike: Boolean(part.isWordLike),
      })
    }
    this.wordBoundaries = words
  }

  /** Returns the grapheme boundary after `offset` (the text length at the end). */
  nextOffset(offset: number): number {
    const target = this.snapToGraphemeBoundary(offset)
    let lo = 0
    let hi = this.graphemeBoundaries.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = this.graphemeBoundaries[mid]!
      if (v <= target) lo = mid + 1
      else hi = mid - 1
    }
    return this.graphemeBoundaries[Math.min(lo, this.graphemeBoundaries.length - 1)] ?? this.text.length
  }

  /** Returns the grapheme boundary before `offset` (0 at the start). */
  prevOffset(offset: number): number {
    const target = this.snapToGraphemeBoundary(offset)
    let lo = 0
    let hi = this.graphemeBoundaries.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = this.graphemeBoundaries[mid]!
      if (v < target) lo = mid + 1
      else hi = mid - 1
    }
    return this.graphemeBoundaries[Math.max(0, hi)] ?? 0
  }

  /** Rounds `offset` down to the nearest grapheme boundary, clamped to the text. */
  snapToGraphemeBoundary(offset: number): number {
    if (offset <= 0) return 0
    if (offset >= this.text.length) return this.text.length
    let best = 0
    for (const b of this.graphemeBoundaries) {
      if (b > offset) break
      best = b
    }
    return best
  }

  getGraphemeBoundaries(): number[] {
    return [...this.graphemeBoundaries]
  }

  getWordBoundaries(): WordBoundary[] {
    return [...this.wordBoundaries]
  }

  /** Terminal display width of `text` up to `index`. */
  stringIndexToDisplayWidth(text: string, index: number): number {
    const i = Math.max(0, Math.min(index, text.length))
    return stringWidth(text.slice(0, i))
  }

  /** Largest index into `text` whose prefix fits within `targetWidth` columns, never splitting a grapheme. */
  displayWidthToStringIndex(text: string, targetWidth: number): number {
    if (targetWidth <= 0) return 0
    let width = 0
    let index = 0
    for (const { index: i, segment } of MeasuredText.graphemeSegmenter.segment(text)) {
      const next = width + stringWidth(segment)
      if (next > targetWidth) break
      width = next
      index = i + segment.length
    }
    return index
  }

  /** Visual lines (see wrapVisualLines) as text. Cached per instance. */
  getWrappedText(): string[] {
    this.wrappedTextCache ??= this.getVisualLines().map(({ start, end }) => this.text.slice(start, end))
    return this.wrappedTextCache
  }

  private getVisualLines(): VisualLine[] {
    return this.visualLinesCache ??= wrapVisualLines(this.text, this.columns)
  }

  /** Number of visual lines after wrapping (not newline count). */
  get lineCount(): number {
    return this.getVisualLines().length
  }

  /** Converts an offset to its visual { line, column }, the column in display width. A line owns the offsets from its start up to the next line's start, so the space eaten at a word-wrap belongs to the line it ends. */
  getPositionFromOffset(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length))
    const lines = this.getVisualLines()
    let line = 0
    while (line + 1 < lines.length && lines[line + 1]!.start <= clamped) line++
    return { line, column: stringWidth(this.text.slice(lines[line]!.start, clamped)) }
  }

  /** Converts a visual { line, column } back to an offset, clamping the line and the column to that line's text. */
  getOffsetFromPosition(position: Position): number {
    const lines = this.getVisualLines()
    const { start, end } = lines[Math.max(0, Math.min(position.line, lines.length - 1))]!
    return start + this.displayWidthToStringIndex(this.text.slice(start, end), position.column)
  }

  /** Display width of wrapped line `line` (0 when out of range). */
  getLineLength(line: number): number {
    const wrapped = this.getWrappedText()
    const text = wrapped[line] ?? ''
    return stringWidth(text)
  }
}
