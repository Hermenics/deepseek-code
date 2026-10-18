import { expect, it } from 'bun:test'
import { quoteCheckout } from '../packages/checkout/src/index.js'
import { calculateShipping } from '../packages/shipping/src/index.js'
import { calculateTax } from '../packages/tax/src/index.js'

it('calculates tax at 8.25% and rounds to the nearest cent', () => {
  expect(calculateTax(1000)).toBe(83)
  expect(calculateTax(5000)).toBe(413)
})

it('charges shipping below the free-shipping threshold', () => {
  expect(calculateShipping(4999)).toBe(599)
  expect(calculateShipping(5000)).toBe(0)
})

it('integrates both package results in the shared checkout contract', () => {
  expect(quoteCheckout(4999)).toEqual({
    subtotalCents: 4999,
    taxCents: 412,
    shippingCents: 599,
    totalCents: 6010,
  })
  expect(quoteCheckout(5000)).toEqual({
    subtotalCents: 5000,
    taxCents: 413,
    shippingCents: 0,
    totalCents: 5413,
  })
})
