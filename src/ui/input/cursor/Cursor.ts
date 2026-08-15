import { MeasuredText } from './MeasuredText.js'
import { pushToKillRing } from './killRing.js'

/** Placeholder the input inserts for a long paste — edited as one unit. */
const PASTE_PLACEHOLDER_RE = /\[Text #\d+\]/g

/**
 * Finds the paste placeholder a delete at `offset` would cut into, so it gets
 * removed whole instead of leaving a broken `[Text #1` behind.
 * `before` looks at what a backspace would eat, `after` at what delete would.
 */
export function placeholderSpanAt(
  text: string,
  offset: number,
  side: 'before' | 'after',
): { start: number; end: number } | null {
  PASTE_PLACEHOLDER_RE.lastIndex = 0
  for (const match of text.matchAll(PASTE_PLACEHOLDER_RE)) {
    const start = match.index
    const end = start + match[0].length
    const touches = side === 'before' ? offset > start && offset <= end : offset >= start && offset < end
    if (touches) return { start, end }
  }
  return null
}

export class Cursor {
  readonly offset: number
  readonly measuredText: MeasuredText

  constructor(measuredText: MeasuredText, offset: number = 0) {
    this.measuredText = measuredText
    this.offset = Math.max(0, Math.min(this.text.length, offset))
  }

  static fromText(text: string, columns: number, offset: number = 0): Cursor {
    return new Cursor(new MeasuredText(text, Math.max(1, columns - 1)), offset)
  }

  get text(): string {
    return this.measuredText.text
  }

  left(): Cursor {
    if (this.offset <= 0) return this
    return new Cursor(this.measuredText, this.measuredText.prevOffset(this.offset))
  }

  right(): Cursor {
    if (this.offset >= this.text.length) return this
    return new Cursor(this.measuredText, this.measuredText.nextOffset(this.offset))
  }

  up(): Cursor {
    const pos = this.getPosition()
    if (pos.line <= 0) return this
    return new Cursor(this.measuredText, this.measuredText.getOffsetFromPosition({ line: pos.line - 1, column: pos.column }))
  }

  down(): Cursor {
    const pos = this.getPosition()
    if (pos.line >= this.measuredText.lineCount - 1) return this
    return new Cursor(this.measuredText, this.measuredText.getOffsetFromPosition({ line: pos.line + 1, column: pos.column }))
  }

  prevWord(): Cursor {
    if (this.offset <= 0) return this
    const boundaries = this.measuredText.getWordBoundaries()
    let target = 0
    for (let i = boundaries.length - 1; i >= 0; i--) {
      const b = boundaries[i]!
      if (!b.isWordLike) continue
      if (b.start < this.offset && this.offset <= b.end) {
        target = b.start
        break
      }
      if (b.end <= this.offset) {
        target = b.start
        break
      }
    }
    return new Cursor(this.measuredText, target)
  }

  nextWord(): Cursor {
    if (this.offset >= this.text.length) return this
    const boundaries = this.measuredText.getWordBoundaries()
    for (const b of boundaries) {
      if (!b.isWordLike) continue
      if (b.start > this.offset) return new Cursor(this.measuredText, b.start)
      if (this.offset >= b.start && this.offset < b.end) continue
    }
    return new Cursor(this.measuredText, this.text.length)
  }

  startOfLine(): Cursor {
    const pos = this.getPosition()
    return new Cursor(this.measuredText, this.measuredText.getOffsetFromPosition({ line: pos.line, column: 0 }))
  }

  endOfLine(): Cursor {
    const pos = this.getPosition()
    const col = this.measuredText.getLineLength(pos.line)
    return new Cursor(this.measuredText, this.measuredText.getOffsetFromPosition({ line: pos.line, column: col }))
  }

  insert(text: string): Cursor {
    const nextText = this.text.slice(0, this.offset) + text + this.text.slice(this.offset)
    return Cursor.fromText(nextText, this.measuredText.columns + 1, this.offset + text.length)
  }

  backspace(): Cursor {
    if (this.offset === 0) return this
    const placeholder = placeholderSpanAt(this.text, this.offset, 'before')
    if (placeholder) return this.cut(placeholder.start, placeholder.end)
    const start = this.measuredText.prevOffset(this.offset)
    return this.cut(start, this.offset)
  }

  del(): Cursor {
    if (this.offset >= this.text.length) return this
    const placeholder = placeholderSpanAt(this.text, this.offset, 'after')
    if (placeholder) return this.cut(placeholder.start, placeholder.end)
    const end = this.measuredText.nextOffset(this.offset)
    return this.cut(this.offset, end)
  }

  /** Removes [start, end) and leaves the cursor where the text was. */
  private cut(start: number, end: number): Cursor {
    const nextText = this.text.slice(0, start) + this.text.slice(end)
    return Cursor.fromText(nextText, this.measuredText.columns + 1, start)
  }

  deleteToLineEnd(): { cursor: Cursor; killed: string } {
    const end = this.endOfLine().offset
    const realEnd = end === this.offset && this.text[this.offset] === '\n' ? this.offset + 1 : end
    const killed = this.text.slice(this.offset, realEnd)
    if (killed) pushToKillRing(killed, 'append')
    const nextText = this.text.slice(0, this.offset) + this.text.slice(realEnd)
    return { cursor: Cursor.fromText(nextText, this.measuredText.columns + 1, this.offset), killed }
  }

  deleteToLineStart(): { cursor: Cursor; killed: string } {
    const start = this.startOfLine().offset
    const killed = this.text.slice(start, this.offset)
    if (killed) pushToKillRing(killed, 'prepend')
    const nextText = this.text.slice(0, start) + this.text.slice(this.offset)
    return { cursor: Cursor.fromText(nextText, this.measuredText.columns + 1, start), killed }
  }

  deleteWordBefore(): { cursor: Cursor; killed: string } {
    const start = this.prevWord().offset
    const killed = this.text.slice(start, this.offset)
    if (killed) pushToKillRing(killed, 'prepend')
    const nextText = this.text.slice(0, start) + this.text.slice(this.offset)
    return { cursor: Cursor.fromText(nextText, this.measuredText.columns + 1, start), killed }
  }

  deleteWordAfter(): Cursor {
    const end = this.nextWord().offset
    if (end <= this.offset) return this
    const killed = this.text.slice(this.offset, end)
    if (killed) pushToKillRing(killed, 'append')
    const nextText = this.text.slice(0, this.offset) + this.text.slice(end)
    return Cursor.fromText(nextText, this.measuredText.columns + 1, this.offset)
  }

  nextVimWord(): Cursor { return this.nextWord() }
  prevVimWord(): Cursor { return this.prevWord() }
  endOfVimWord(): Cursor { return this.nextWord().left() }

  isAtStart(): boolean { return this.offset === 0 }
  isAtEnd(): boolean { return this.offset === this.text.length }
  equals(other: Cursor): boolean { return this.offset === other.offset && this.text === other.text }
  getPosition(): { line: number; column: number } { return this.measuredText.getPositionFromOffset(this.offset) }
}
