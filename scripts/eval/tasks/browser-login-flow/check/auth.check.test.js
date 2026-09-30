import { expect, test } from 'bun:test'
import { loginRequest } from '../src/auth.js'

test('sends the team code in the field the server expects', () => {
  expect(JSON.parse(loginRequest('blue-1').body)).toEqual({ team: 'blue-1' })
})
