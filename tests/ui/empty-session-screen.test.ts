import { expect, test } from 'bun:test'
import { canShowHomeAnimation } from '../../src/ui/layout/EmptySessionScreen.js'

test('home animation requires a terminal at least 70 columns by 24 rows', () => {
  expect(canShowHomeAnimation(70, 24)).toBe(true)
  expect(canShowHomeAnimation(69, 24)).toBe(false)
  expect(canShowHomeAnimation(70, 23)).toBe(false)
})
