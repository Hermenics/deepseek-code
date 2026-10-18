import { expect, it } from 'bun:test'
import { formatAmount } from '../src/formatAmount.js'

it('formats integer USD cents with two decimal places', () => {
  expect(formatAmount(1234)).toBe('$12.34')
  expect(formatAmount(7)).toBe('$0.07')
  expect(formatAmount(0)).toBe('$0.00')
  expect(formatAmount(-105)).toBe('-$1.05')
})
