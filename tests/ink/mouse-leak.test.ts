import { describe, expect, test } from 'bun:test'
import { INITIAL_STATE, parseMultipleKeypresses, type ParsedInput } from '../../src/ink/parse-keypress.js'

/** Feeds chunks (null = App's 50ms flush timer firing) and returns every parsed event. */
function feed(chunks: (string | null)[]): ParsedInput[] {
  let state = INITIAL_STATE
  const out: ParsedInput[] = []
  for (const chunk of chunks) {
    const [keys, next] = parseMultipleKeypresses(state, chunk)
    state = next
    out.push(...keys)
  }
  return out
}

/** Text that would reach the prompt: key events whose sequence has no ESC. */
const leakedText = (events: ParsedInput[]) =>
  events.filter(e => e.kind === 'key' && !e.sequence?.startsWith('\x1b')).map(e => (e.kind === 'key' ? e.sequence : ''))

describe('mouse reports never leak raw coordinates into the input', () => {
  test('flush timer firing mid SGR report waits for the rest', () => {
    const events = feed(['\x1b[<35;4', null, '2;10M'])
    expect(leakedText(events)).toEqual([])
    expect(events.map(e => e.kind)).toEqual(['mouse'])
  })

  test('flush right after the `<` also waits', () => {
    expect(leakedText(feed(['\x1b[<', null, '35;42;10M']))).toEqual([])
  })

  test('orphaned tail followed by typed text keeps the text and drops the tail', () => {
    const events = feed(['\x1b', null, '[<0;42;10Mabc'])
    expect(leakedText(events)).toEqual(['abc'])
    expect(events.some(e => e.kind === 'mouse')).toBe(true)
  })

  test('typed text that merely looks like a tail is kept', () => {
    expect(leakedText(feed(['[MAX]']))).toEqual(['[MAX]'])
  })
})
