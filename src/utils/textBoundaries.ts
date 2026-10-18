const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function clampOffset(text: string, offset: number): number {
  return Math.max(0, Math.min(text.length, Number.isNaN(offset) ? 0 : Math.trunc(offset)))
}

/** Returns the last extended-grapheme boundary at or before a UTF-16 offset. */
export function safeGraphemeEnd(text: string, offset: number): number {
  const bounded = clampOffset(text, offset)
  if (bounded === 0 || bounded === text.length) return bounded
  let boundary = 0
  for (const part of graphemes.segment(text)) {
    const end = part.index + part.segment.length
    if (end > bounded) return part.index
    boundary = end
  }
  return boundary
}

/** Returns the first extended-grapheme boundary at or after a UTF-16 offset. */
export function safeGraphemeStart(text: string, offset: number): number {
  const bounded = clampOffset(text, offset)
  if (bounded === 0 || bounded === text.length) return bounded
  for (const part of graphemes.segment(text)) {
    const end = part.index + part.segment.length
    if (part.index >= bounded) return part.index
    if (end > bounded) return end
  }
  return text.length
}

export function isGraphemeBoundary(text: string, offset: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length && safeGraphemeStart(text, offset) === offset
}
