export const DEMO_PROMPT = 'Add email validation to the signup form, add focused tests, and run the test suite.'

export const UPDATED_SOURCE = `export function canSubmitSignup(email) {
  if (typeof email !== 'string') return false;
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim());
}
`

export const UPDATED_TESTS = `import { expect, test } from 'bun:test'
import { canSubmitSignup } from '../src/signup.js'

test('accepts a valid email address', () => {
  expect(canSubmitSignup('person@example.com')).toBe(true)
})

test('trims whitespace around a valid email address', () => {
  expect(canSubmitSignup('  person@example.com  ')).toBe(true)
})

test('rejects missing and malformed email addresses', () => {
  for (const email of ['', '   ', 'not-an-email', 'person@', '@example.com']) {
    expect(canSubmitSignup(email)).toBe(false)
  }
})

test('rejects non-string input', () => {
  expect(canSubmitSignup(null)).toBe(false)
})
`
