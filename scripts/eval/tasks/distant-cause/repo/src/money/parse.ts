import type { Currency } from '../config/currencies'
import type { Money } from './types'

/** Parses a decimal string such as "12.50" or "1500" into minor units. */
export function parseAmount(text: string, currency: Currency): Money {
  const trimmed = text.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`invalid amount: ${text}`)
  const [whole, fraction = ''] = trimmed.split('.')
  const digits = fraction.padEnd(2, '0').slice(0, 2)
  return { minor: Number(whole) * 100 + Number(digits), currency }
}
