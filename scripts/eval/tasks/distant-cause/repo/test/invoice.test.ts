import { expect, it } from 'bun:test'
import { createOrder } from '../src/orders/order'
import { renderInvoice } from '../src/reports/invoice'

it('renders a USD invoice', () => {
  const order = createOrder({ currency: 'USD', lines: [{ sku: 'TEA-01', quantity: 2 }, { sku: 'CUP-02', quantity: 1 }] })
  const invoice = renderInvoice(order)
  expect(invoice).toContain('2 × Sencha tea  $25.00')
  expect(invoice).toContain('Subtotal  $33.00')
  expect(invoice).toContain('Shipping  $5.00')
  expect(invoice).toContain('Total  $38.00')
})
