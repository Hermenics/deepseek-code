import { expect, test } from 'bun:test'
import { cartTotal, formatMoney } from '../src/cart.js'

test('empty cart', () => {
  expect(cartTotal([])).toBe(0)
  expect(formatMoney(0)).toBe('$0.00')
})
