import { expect, it } from 'bun:test'
import { fmt } from '../src/money'

it('formats cents as BRL', () => {
  expect(fmt(123456)).toBe('R$ 1234,56')
})
