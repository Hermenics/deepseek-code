import { expect, test } from 'bun:test'
import { columnsForWidth } from '../src/layout.js'

test('uses three columns on a wide desktop', () => {
  expect(columnsForWidth(1200)).toBe(3)
})
