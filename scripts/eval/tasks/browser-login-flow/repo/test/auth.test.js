import { expect, test } from 'bun:test'
import { loginRequest } from '../src/auth.js'

test('posts JSON', () => {
  expect(loginRequest('x').method).toBe('POST')
})
