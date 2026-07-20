type TextObjectFn = (text: string, cursor: number) => [number, number]

function findWordBounds(text: string, cursor: number): [number, number] {
  if (cursor >= text.length) return [cursor, cursor]

  const isWord = (ch: string) => /\w/.test(ch)
  const ch = text[cursor]!

  if (isWord(ch)) {
    let start = cursor
    let end = cursor
    while (start > 0 && isWord(text[start - 1]!)) start--
    while (end < text.length && isWord(text[end]!)) end++
    return [start, end]
  }

  // On whitespace or punctuation — return just the char
  return [cursor, cursor + 1]
}

function innerWord(text: string, cursor: number): [number, number] {
  return findWordBounds(text, cursor)
}

function aroundWord(text: string, cursor: number): [number, number] {
  const [start, end] = findWordBounds(text, cursor)
  // Include trailing space if present
  if (end < text.length && /\s/.test(text[end]!)) return [start, end + 1]
  // Or leading space
  if (start > 0 && /\s/.test(text[start - 1]!)) return [start - 1, end]
  return [start, end]
}

function findPairBounds(
  text: string,
  cursor: number,
  open: string,
  close: string,
  inner: boolean
): [number, number] {
  // Search backward for open char
  let start = cursor
  while (start >= 0 && text[start] !== open) start--
  if (start < 0) return [cursor, cursor]

  // Search forward for close char
  let end = cursor
  while (end < text.length && text[end] !== close) end++
  if (end >= text.length) return [cursor, cursor]

  if (inner) return [start + 1, end]
  return [start, end + 1]
}

function makeQuoteObject(quote: string, inner: boolean): TextObjectFn {
  return (text, cursor) => {
    // Find the quote pair containing cursor — include cursor position in opening search
    let before = text[cursor] === quote ? cursor : cursor - 1
    while (before >= 0 && text[before] !== quote) before--
    let after = before === cursor ? cursor + 1 : cursor
    while (after < text.length && text[after] !== quote) after++

    if (before < 0 || after >= text.length) return [cursor, cursor]
    if (inner) return [before + 1, after]
    return [before, after + 1]
  }
}

export function getTextObject(
  key: string,
  modifier: 'i' | 'a'
): TextObjectFn | null {
  const inner = modifier === 'i'

  switch (key) {
    case 'w':
      return inner ? innerWord : aroundWord

    case '"':
      return makeQuoteObject('"', inner)

    case "'":
      return makeQuoteObject("'", inner)

    case '`':
      return makeQuoteObject('`', inner)

    case '(':
    case ')':
      return (text, cursor) => findPairBounds(text, cursor, '(', ')', inner)

    case '{':
    case '}':
      return (text, cursor) => findPairBounds(text, cursor, '{', '}', inner)

    case '[':
    case ']':
      return (text, cursor) => findPairBounds(text, cursor, '[', ']', inner)

    default:
      return null
  }
}
