import stringWidth from 'string-width'

type Position = { line: number; column: number }
type WordBoundary = { start: number; end: number; isWordLike: boolean }

export class MeasuredText {
  readonly text: string
  readonly columns: number

  private readonly graphemeBoundaries: number[]
  private readonly wordBoundaries: WordBoundary[]
  private wrappedTextCache: string[] | null = null

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

  stringIndexToDisplayWidth(text: string, index: number): number {
    const i = Math.max(0, Math.min(index, text.length))
    return stringWidth(text.slice(0, i))
  }

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

  getWrappedText(): string[] {
    if (this.wrappedTextCache) return this.wrappedTextCache

    const result: string[] = []
    const lines = this.text.split('\n')

    for (const rawLine of lines) {
      if (rawLine.length === 0) {
        result.push('')
        continue
      }

      let current = ''
      let currentWidth = 0

      for (const { segment } of MeasuredText.graphemeSegmenter.segment(rawLine)) {
        const w = stringWidth(segment)
        if (current.length > 0 && currentWidth + w > this.columns) {
          result.push(current)
          current = segment
          currentWidth = w
        } else {
          current += segment
          currentWidth += w
        }
      }
      result.push(current)
    }

    this.wrappedTextCache = result.length > 0 ? result : ['']
    return this.wrappedTextCache
  }

  get lineCount(): number {
    return this.getWrappedText().length
  }

  getPositionFromOffset(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length))
    const before = this.text.slice(0, clamped)
    const lines = before.split('\n')
    const line = lines.length - 1
    const lineText = lines[line] ?? ''
    return { line, column: stringWidth(lineText) }
  }

  getOffsetFromPosition(position: Position): number {
    const wrapped = this.getWrappedText()
    const line = Math.max(0, Math.min(position.line, wrapped.length - 1))

    const beforeLines = wrapped.slice(0, line)
    let base = 0
    for (const l of beforeLines) base += l.length

    if (line < wrapped.length - 1 || this.text.includes('\n')) {
      const hardLines = this.text.split('\n')
      base = 0
      for (let i = 0; i < line; i++) {
        base += (hardLines[i] ?? '').length + 1
      }
      const lineText = hardLines[line] ?? ''
      return base + this.displayWidthToStringIndex(lineText, position.column)
    }

    const lineText = wrapped[line] ?? ''
    return base + this.displayWidthToStringIndex(lineText, position.column)
  }

  getLineLength(line: number): number {
    const wrapped = this.getWrappedText()
    const text = wrapped[line] ?? ''
    return stringWidth(text)
  }
}
