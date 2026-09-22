import type { Money } from './types'

/** Throws when two amounts are in different currencies. */
function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`)
}

/** Sum of two amounts in the same currency. */
export function add(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { minor: a.minor + b.minor, currency: a.currency }
}

/** Difference of two amounts in the same currency. */
export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { minor: a.minor - b.minor, currency: a.currency }
}

/** Amount scaled by a factor, rounded to the smallest unit. */
export function multiply(a: Money, factor: number): Money {
  return { minor: Math.round(a.minor * factor), currency: a.currency }
}

/** Zero in the given currency. */
export function zero(currency: Money['currency']): Money {
  return { minor: 0, currency }
}

/** Sum of amounts in one currency. */
export function sum(items: Money[], currency: Money['currency']): Money {
  return items.reduce(add, zero(currency))
}
