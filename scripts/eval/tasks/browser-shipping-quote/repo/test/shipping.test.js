import { expect, test } from 'bun:test'
import { estimateDays } from '../src/shipping.js'

test('returns null when no delivery methods are available', () => {
  expect(estimateDays([], 'express')).toBeNull()
})
