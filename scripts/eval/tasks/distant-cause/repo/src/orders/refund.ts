import { parseAmount } from '../money/parse'
import { subtract } from '../money/arith'
import type { Money } from '../money/types'
import type { Order } from './order'

/** A partial refund entered by support staff as a decimal string; never more than the order total. */
export function refund(order: Order, amountText: string): { refunded: Money; remaining: Money } {
  const refunded = parseAmount(amountText, order.total.currency)
  if (refunded.minor > order.total.minor) throw new Error('refund exceeds order total')
  return { refunded, remaining: subtract(order.total, refunded) }
}
