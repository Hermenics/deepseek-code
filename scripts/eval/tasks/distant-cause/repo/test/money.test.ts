import { expect, it } from 'bun:test'
import { formatMoney } from '../src/money/format'
import { parseAmount } from '../src/money/parse'

it('parses and formats dollars and euros', () => {
  expect(parseAmount('12.50', 'USD')).toEqual({ minor: 1250, currency: 'USD' })
  expect(parseAmount('7', 'EUR')).toEqual({ minor: 700, currency: 'EUR' })
  expect(formatMoney({ minor: 123456, currency: 'USD' })).toBe('$1,234.56')
})
