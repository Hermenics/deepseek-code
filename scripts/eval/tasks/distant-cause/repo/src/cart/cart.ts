import { unitPrice } from '../catalog/pricing'
import type { Currency } from '../config/currencies'
import { multiply, sum } from '../money/arith'
import type { Money } from '../money/types'

export interface CartLine {
  sku: string
  quantity: number
}

export interface Cart {
  currency: Currency
  lines: CartLine[]
}

export function lineTotal(cart: Cart, line: CartLine): Money {
  return multiply(unitPrice(line.sku, cart.currency), line.quantity)
}

export function cartSubtotal(cart: Cart): Money {
  return sum(cart.lines.map((line) => lineTotal(cart, line)), cart.currency)
}
