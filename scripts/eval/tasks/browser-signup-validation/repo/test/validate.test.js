import { expect, test } from 'bun:test'
import { isValidEmail } from '../src/validate.js'

test('accepts a plain address and rejects garbage', () => {
  expect(isValidEmail('ana@example.com')).toBe(true)
  expect(isValidEmail('not an email')).toBe(false)
})
