import { expect, test } from 'bun:test'
import { cartTotal, formatMoney } from '../src/cart.js'

test('multiplies price by quantity', () => {
  expect(cartTotal([{ priceCents: 250, quantity: 3 }, { priceCents: 199, quantity: 2 }])).toBe(1148)
  expect(formatMoney(cartTotal([{ priceCents: 1999, quantity: 4 }]))).toBe('$79.96')
})
