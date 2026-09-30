import { expect, test } from 'bun:test'
import { isValidEmail } from '../src/validate.js'

test('accepts plus addressing and still rejects invalid addresses', () => {
  expect(isValidEmail('ana+team1@example.com')).toBe(true)
  expect(isValidEmail('ana@example.com')).toBe(true)
  expect(isValidEmail('ana@')).toBe(false)
  expect(isValidEmail('@example.com')).toBe(false)
  expect(isValidEmail('ana example@example.com')).toBe(false)
})
