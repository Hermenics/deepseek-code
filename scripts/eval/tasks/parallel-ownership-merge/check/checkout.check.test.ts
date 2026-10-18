import { expect, it } from 'bun:test'
import { quoteCheckout } from '../repo/packages/checkout/src/index.js'
import { calculateShipping } from '../repo/packages/shipping/src/index.js'
import { calculateTax } from '../repo/packages/tax/src/index.js'

it('implements the tax package across rounding and threshold cases', () => {
  expect(calculateTax(0)).toBe(0)
  expect(calculateTax(1)).toBe(0)
  expect(calculateTax(1000)).toBe(83)
  expect(calculateTax(5000)).toBe(413)
})

it('implements the shipping package on both sides of the free threshold', () => {
  expect(calculateShipping(0)).toBe(599)
  expect(calculateShipping(4999)).toBe(599)
  expect(calculateShipping(5000)).toBe(0)
  expect(calculateShipping(12000)).toBe(0)
})

it('preserves the shared quote contract with both independent package changes', () => {
  expect(quoteCheckout(4999)).toEqual({ subtotalCents: 4999, taxCents: 412, shippingCents: 599, totalCents: 6010 })
  expect(quoteCheckout(5000)).toEqual({ subtotalCents: 5000, taxCents: 413, shippingCents: 0, totalCents: 5413 })
})

