import { cartSubtotal, lineTotal, type Cart } from '../cart/cart'
import { findProduct } from '../catalog/products'
import { add } from '../money/arith'
import type { Money } from '../money/types'
import { shippingFee } from '../shipping/fees'

export interface OrderLine {
  sku: string
  name: string
  quantity: number
  total: Money
}

export interface Order {
  id: string
  lines: OrderLine[]
  subtotal: Money
  shipping: Money
  total: Money
}

let nextId = 1

/** Turns a cart into an order with line totals, subtotal, shipping and total. */
export function createOrder(cart: Cart): Order {
  const lines = cart.lines.map((line) => ({
    sku: line.sku,
    name: findProduct(line.sku).name,
    quantity: line.quantity,
    total: lineTotal(cart, line),
  }))
  const subtotal = cartSubtotal(cart)
  const shipping = shippingFee(cart.currency, subtotal)
  return { id: `ORD-${nextId++}`, lines, subtotal, shipping, total: add(subtotal, shipping) }
}
