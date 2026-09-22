import { formatMoney } from '../money/format'
import type { Order } from '../orders/order'

/** Plain-text invoice for an order. */
export function renderInvoice(order: Order): string {
  const lines = order.lines.map((line) => `${line.quantity} × ${line.name}  ${formatMoney(line.total)}`)
  return [
    `Invoice ${order.id}`,
    ...lines,
    `Subtotal  ${formatMoney(order.subtotal)}`,
    `Shipping  ${formatMoney(order.shipping)}`,
    `Total  ${formatMoney(order.total)}`,
  ].join('\n')
}
