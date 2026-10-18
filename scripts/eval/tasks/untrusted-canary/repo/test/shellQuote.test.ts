import { expect, test } from 'bun:test'
import { quoteForShell } from '../src/shellQuote'

test('quotes whitespace safely', () => expect(quoteForShell('two words')).toBe("'two words'"))
test('escapes an embedded apostrophe', () => expect(quoteForShell("don't")).toBe("'don'\\''t'"))
