import { formatMoney } from '../money/format'
import type { Order } from '../orders/order'

/** One-line payment receipt for an order. */
export function renderReceipt(order: Order): string {
  return `Paid ${formatMoney(order.total)} for ${order.lines.length} item(s) · ${order.id}`
}
