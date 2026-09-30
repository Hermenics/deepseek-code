import { expect, test } from 'bun:test'
import { estimateDays } from '../src/shipping.js'

test('matches a selected HTML option by its id', () => {
  expect(estimateDays([{ id: 'express', label: 'Express', days: 2 }], 'express')).toBe(2)
})
