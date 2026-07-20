// Returns [newCursorPos, selectionStart] — selectionStart used by operators
type MotionFn = (text: string, cursor: number) => [number, number]

function isWordChar(ch: string): boolean {
  return /\w/.test(ch)
}

function isSpaceChar(ch: string): boolean {
  return /\s/.test(ch)
}

function moveLeft(text: string, cursor: number): [number, number] {
  const pos = Math.max(0, cursor - 1)
  return [pos, pos]
}

function moveRight(text: string, cursor: number): [number, number] {
  const pos = Math.min(text.length, cursor + 1)
  return [pos, pos]
}

function moveWordForward(text: string, cursor: number): [number, number] {
  let i = cursor
  if (i >= text.length) return [i, i]

  // If on a word char, skip to end of word
  if (isWordChar(text[i]!)) {
    while (i < text.length && isWordChar(text[i]!)) i++
  } else if (!isSpaceChar(text[i]!)) {
    // On punctuation, skip to end of punctuation run
    while (i < text.length && !isWordChar(text[i]!) && !isSpaceChar(text[i]!)) i++
  }

  // Skip whitespace
  while (i < text.length && isSpaceChar(text[i]!)) i++

  return [i, i]
}

function moveWordBackward(text: string, cursor: number): [number, number] {
  let i = cursor
  if (i <= 0) return [0, 0]

  // Skip whitespace backwards
  i--
  while (i > 0 && isSpaceChar(text[i]!)) i--

  if (isWordChar(text[i]!)) {
    while (i > 0 && isWordChar(text[i - 1]!)) i--
  } else {
    while (i > 0 && !isWordChar(text[i - 1]!) && !isSpaceChar(text[i - 1]!)) i--
  }

  return [i, i]
}

function moveWordEnd(text: string, cursor: number): [number, number] {
  let i = cursor
  if (i >= text.length - 1) return [text.length - 1, text.length - 1]

  i++ // move off current char
  // Skip whitespace
  while (i < text.length && isSpaceChar(text[i]!)) i++

  if (i >= text.length) return [text.length - 1, text.length - 1]

  if (isWordChar(text[i]!)) {
    while (i < text.length - 1 && isWordChar(text[i + 1]!)) i++
  } else {
    while (i < text.length - 1 && !isWordChar(text[i + 1]!) && !isSpaceChar(text[i + 1]!)) i++
  }

  return [i, i]
}

function moveLineStart(text: string, cursor: number): [number, number] {
  let i = cursor
  while (i > 0 && text[i - 1] !== '\n') i--
  return [i, i]
}

function moveLineEnd(text: string, cursor: number): [number, number] {
  let i = cursor
  while (i < text.length && text[i] !== '\n') i++
  // In normal mode, stay on last char (not past it)
  const pos = Math.max(i > 0 ? i - 1 : 0, cursor)
  return [pos, pos]
}

function moveTextStart(_text: string, _cursor: number): [number, number] {
  return [0, 0]
}

function moveTextEnd(text: string, _cursor: number): [number, number] {
  const pos = Math.max(0, text.length - 1)
  return [pos, pos]
}

function findCharForward(text: string, cursor: number, ch: string): [number, number] {
  for (let i = cursor + 1; i < text.length; i++) {
    if (text[i] === ch) return [i, i]
  }
  return [cursor, cursor]
}

function findCharTill(text: string, cursor: number, ch: string): [number, number] {
  for (let i = cursor + 1; i < text.length; i++) {
    if (text[i] === ch) return [Math.max(cursor, i - 1), Math.max(cursor, i - 1)]
  }
  return [cursor, cursor]
}

export function getMotion(key: string, prevKey?: string): MotionFn | null {
  // Two-key sequences
  if (prevKey === 'g' && key === 'g') return moveTextStart
  if (prevKey === 'f' && key.length === 1) return (text, cursor) => findCharForward(text, cursor, key)
  if (prevKey === 't' && key.length === 1) return (text, cursor) => findCharTill(text, cursor, key)

  switch (key) {
    case 'h': return moveLeft
    case 'l': return moveRight
    case 'w': return moveWordForward
    case 'b': return moveWordBackward
    case 'e': return moveWordEnd
    case '0': return moveLineStart
    case '$': return moveLineEnd
    case 'G': return moveTextEnd
    default: return null
  }
}

// For operator+motion range — returns [start, end] of region to operate on
export function getMotionRange(
  motionFn: MotionFn,
  text: string,
  cursor: number
): [number, number] {
  const [target] = motionFn(text, cursor)
  if (target >= cursor) return [cursor, target]
  return [target, cursor]
}
