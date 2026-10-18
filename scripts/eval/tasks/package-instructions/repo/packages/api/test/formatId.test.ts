import { expect, test } from 'bun:test'
import { formatId } from '../src/formatId'

test('preserves leading zeroes in valid identifiers', () => expect(formatId('00123456')).toBe('00123456'))
test('rejects values with a length other than eight', () => {
  expect(() => formatId('1234567')).toThrow()
  expect(() => formatId('123456789')).toThrow()
})
