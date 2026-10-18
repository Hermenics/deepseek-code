import { expect, test } from 'bun:test'
import { symbolPathForLine } from '../src/tools/Grep/symbols.js'

test('selects the narrowest nested symbol containing the grep line', () => {
  const symbols = [{
    name: 'Widget',
    range: { start: { line: 0, character: 0 }, end: { line: 8, character: 1 } },
    children: [
      { name: 'render', range: { start: { line: 2, character: 0 }, end: { line: 5, character: 1 } } },
      { name: 'save', range: { start: { line: 5, character: 0 }, end: { line: 8, character: 0 } } },
    ],
  }]

  expect(symbolPathForLine(symbols, 4)).toBe('Widget > render')
  expect(symbolPathForLine(symbols, 8)).toBe('Widget > save')
  expect(symbolPathForLine(symbols, 9)).toBe('Widget')
  expect(symbolPathForLine(symbols, 10)).toBeUndefined()
})

test('supports flat SymbolInformation results and sanitizes labels from the server', () => {
  const symbols = [{
    name: 'lookup\u001b[31m', containerName: 'Search',
    location: { range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } } },
  }]

  expect(symbolPathForLine(symbols, 2)).toBe('Search > lookup [31m')
  expect(symbolPathForLine(symbols, 4)).toBeUndefined()
  expect(symbolPathForLine({}, 2)).toBeUndefined()
  expect(symbolPathForLine(symbols, 2, 'file:///different.ts')).toBeUndefined()
})
