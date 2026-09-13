import { expect, it } from 'bun:test'
import * as money from '../src/money'
import { cartTotal } from '../src/cart'
import { exportOptions, invoiceLine } from '../src/invoice'
import { receipt } from '../src/receipt'

it('exports formatBRL and no longer exports fmt', () => {
  expect(typeof (money as Record<string, unknown>).formatBRL).toBe('function')
  expect((money as Record<string, unknown>).fmt).toBeUndefined()
})

it('keeps the behavior of every caller', () => {
  expect(cartTotal([{ price: 1050, qty: 2 }])).toBe('R$ 21,00')
  expect(invoiceLine('Plano', 9990)).toBe('[TXT] Plano: R$ 99,90')
  expect(receipt([['Cafe', 750]])).toBe('Cafe        R$ 7,50')
})

it('leaves the unrelated fmt option untouched', () => {
  expect(exportOptions).toEqual({ fmt: 'pdf' })
})
