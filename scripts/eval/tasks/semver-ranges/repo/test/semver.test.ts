import { expect, it } from 'bun:test'
import { compare, parse, satisfies } from '../src/semver'

it('orders versions by semver precedence', () => {
  expect(compare(parse('1.0.0-alpha'), parse('1.0.0'))).toBe(-1)
  expect(compare(parse('1.0.0-alpha.1'), parse('1.0.0-alpha.beta'))).toBe(-1)
  expect(compare(parse('1.0.0-rc.1'), parse('1.0.0-beta.11'))).toBe(1)
})

it('checks plain comparators', () => {
  expect(satisfies('1.2.3', '>=1.2.0 <2.0.0')).toBe(true)
  expect(satisfies('2.0.0', '>=1.2.0 <2.0.0')).toBe(false)
  expect(satisfies('1.2.3', '1.2.3')).toBe(true)
})
