import type { Money } from './types'

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`)
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { minor: a.minor + b.minor, currency: a.currency }
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { minor: a.minor - b.minor, currency: a.currency }
}

export function multiply(a: Money, factor: number): Money {
  return { minor: Math.round(a.minor * factor), currency: a.currency }
}

export function zero(currency: Money['currency']): Money {
  return { minor: 0, currency }
}

export function sum(items: Money[], currency: Money['currency']): Money {
  return items.reduce(add, zero(currency))
}
