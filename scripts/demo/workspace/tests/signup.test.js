import { expect, test } from 'bun:test'
import { canSubmitSignup } from '../src/signup.js'

test('allows a non-empty signup email', () => {
  expect(canSubmitSignup('person@example.com')).toBe(true)
})

test('rejects an empty signup email', () => {
  expect(canSubmitSignup('')).toBe(false)
})
