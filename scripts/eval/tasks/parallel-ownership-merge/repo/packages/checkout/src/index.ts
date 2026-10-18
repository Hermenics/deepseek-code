import { calculateShipping } from '../../shipping/src/index.js'
import { calculateTax } from '../../tax/src/index.js'

export interface CheckoutQuote {
  subtotalCents: number
  taxCents: number
  shippingCents: number
  totalCents: number
}

export function quoteCheckout(subtotalCents: number): CheckoutQuote {
  const taxCents = calculateTax(subtotalCents)
  const shippingCents = calculateShipping(subtotalCents)
  return { subtotalCents, taxCents, shippingCents, totalCents: subtotalCents + taxCents + shippingCents }
}
