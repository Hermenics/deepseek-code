import { expect, it } from 'bun:test'
import { cartSubtotal } from '../src/cart/cart'
import { unitPrice } from '../src/catalog/pricing'
import { formatMoney } from '../src/money/format'
import { parseAmount } from '../src/money/parse'
import { createOrder } from '../src/orders/order'
import { refund } from '../src/orders/refund'
import { renderInvoice } from '../src/reports/invoice'
import { renderReceipt } from '../src/reports/receipt'
import { shippingFee } from '../src/shipping/fees'

it('renders the yen invoice from the report', () => {
  const invoice = renderInvoice(createOrder({ currency: 'JPY', lines: [{ sku: 'TEA-01', quantity: 1 }] }))
  expect(invoice).toContain('1 × Sencha tea  ¥1,500')
  expect(invoice).toContain('Shipping  ¥600')
  expect(invoice).toContain('Total  ¥2,100')
})

it('fixes the other callers of the amount parser too', () => {
  expect(unitPrice('POT-03', 'JPY')).toEqual({ minor: 6800, currency: 'JPY' })
  expect(cartSubtotal({ currency: 'JPY', lines: [{ sku: 'CUP-02', quantity: 3 }] })).toEqual({ minor: 2940, currency: 'JPY' })
  expect(shippingFee('JPY', { minor: 7000, currency: 'JPY' }).minor).toBe(0)
  expect(renderReceipt(createOrder({ currency: 'JPY', lines: [{ sku: 'POT-03', quantity: 1 }] }))).toContain('Paid ¥7,400 ')
  const order = createOrder({ currency: 'JPY', lines: [{ sku: 'TEA-01', quantity: 2 }] })
  expect(formatMoney(refund(order, '500').remaining)).toBe('¥3,100')
})

it('handles three-decimal currencies', () => {
  expect(parseAmount('3.850', 'KWD')).toEqual({ minor: 3850, currency: 'KWD' })
  expect(parseAmount('1.5', 'KWD')).toEqual({ minor: 1500, currency: 'KWD' })
  const invoice = renderInvoice(createOrder({ currency: 'KWD', lines: [{ sku: 'POT-03', quantity: 1 }] }))
  expect(invoice).toContain('Total  KWD 15.625')
})

it('keeps two-decimal currencies unchanged', () => {
  expect(parseAmount('12.5', 'USD')).toEqual({ minor: 1250, currency: 'USD' })
  expect(parseAmount('0.07', 'EUR')).toEqual({ minor: 7, currency: 'EUR' })
  expect(() => parseAmount('1.2.3', 'USD')).toThrow()
})
