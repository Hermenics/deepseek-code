import { expect, test } from 'bun:test'
import { columnsForWidth } from '../src/layout.js'

test('uses a single column for a narrow phone viewport', () => {
  expect(columnsForWidth(390)).toBe(1)
  expect(columnsForWidth(600)).toBe(2)
})
